import { ContextReasonerSignal, reasonSymptomContextOnDevice } from "@/lib/contextReasoner";
import { ColorFeatures } from "@/lib/colorAnalyzer";

type VisionModelPrediction = {
  label: string;
  confidence: number;
  margin: number;
  topK: { label: string; confidence: number }[];
  source: "tflite" | "melange";
};

export type VisionAgentResult = {
  label: string;
  confidence: number;
  severity: "low" | "medium" | "high";
  rationale: string;
};

export type SymptomAgentResult = {
  extractedSymptoms: string[];
  durationDays: number | null;
  concernFlags: string[];
  severity: "low" | "medium" | "high";
};

export type ConsensusResult = {
  condition: string;
  confidence: number;
  urgency: "clear" | "monitor" | "soon" | "urgent";
  whenToSeeDoctor: string;
  explanation: string;
};

export type AgentTrace = {
  agent: "vision-agent" | "symptom-agent" | "triage-agent";
  message: string;
};

export type LocalAgentOutput = {
  vision: VisionAgentResult;
  symptoms: SymptomAgentResult;
  consensus: ConsensusResult;
  trace: AgentTrace[];
};

function mergeSeverity(
  base: "low" | "medium" | "high",
  llmHint: "low" | "medium" | "high" | null
): "low" | "medium" | "high" {
  if (!llmHint) return base;
  return levelFromRank(Math.max(severityRank(base), severityRank(llmHint)));
}

const RISK_TOKENS = [
  "pain",
  "bleeding",
  "swelling",
  "spreading",
  "fever",
  "burning",
  "pus",
  "infected",
];

const HIGH_RISK_CONTEXT_PATTERNS = [
  /\b(severe|unbearable|extreme|intense)\b/i,
  /\b(rapidly|quickly)\s+(worse|worsening|spreading)\b/i,
  /\b(oozing|drainage|discharge|crusting)\b/i,
  /\b(blister|blisters)\b/i,
  /\b(hot|warm)\s+to\s+touch\b/i,
  /\b(face|eye|eyelid|lip|genital)\b/i,
];

const MEDIUM_RISK_CONTEXT_PATTERNS = [
  /\b(itchy|itching|tender|sore|stinging)\b/i,
  /\b(worse|worsening|spreading)\b/i,
  /\b(new\s+rash|new\s+spot|new\s+lesion)\b/i,
  /\b(recurrent|keeps\s+coming\s+back)\b/i,
];

const REASSURING_CONTEXT_PATTERNS = [
  /\b(improving|better|getting\s+better|fading)\b/i,
  /\b(mild|slight)\b/i,
  /\b(no\s+pain|not\s+painful)\b/i,
];

const DURATION_REGEX = /(\d+)\s*(day|days|week|weeks|month|months)/i;

function normalizeDurationDays(symptomText: string): number | null {
  const match = symptomText.match(DURATION_REGEX);
  if (!match) return null;

  const value = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  if (unit.startsWith("week")) return value * 7;
  if (unit.startsWith("month")) return value * 30;
  return value;
}

function severityRank(level: "low" | "medium" | "high"): number {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function levelFromRank(rank: number): "low" | "medium" | "high" {
  if (rank >= 3) return "high";
  if (rank === 2) return "medium";
  return "low";
}

function countPatternMatches(text: string, patterns: RegExp[]): number {
  let matches = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) matches += 1;
  }
  return matches;
}

export function runVisionAgent(modelPrediction?: VisionModelPrediction | null): VisionAgentResult {
  if (modelPrediction) {
    // Always return the best prediction — just lower the severity when confidence is below threshold.
    // This prevents every result from showing "Uncertain visual classification".
    const isLowConfidence = modelPrediction.confidence < 0.60 || modelPrediction.margin < 0.08;

    const severity: "low" | "medium" | "high" = isLowConfidence
      ? "low"
      : modelPrediction.confidence >= 0.92
        ? "high"
        : modelPrediction.confidence >= 0.78
          ? "medium"
          : "low";

    const rationale = isLowConfidence
      ? `Model detected "${modelPrediction.label}" at ${(modelPrediction.confidence * 100).toFixed(0)}% — treating as low-confidence, applying cautious triage.`
      : `On-device model predicted "${modelPrediction.label}" with ${(modelPrediction.confidence * 100).toFixed(0)}% confidence.`;

    return {
      label: modelPrediction.label,   // always use real label, never "uncertain-visual"
      confidence: modelPrediction.confidence,
      severity,
      rationale,
    };
  }

  // Explicit fallback when runtime/model is unavailable.
  return {
    label: "model-unavailable",
    confidence: 0,
    severity: "low",
    rationale:
      "On-device model did not run. This output is symptom-only and should not be treated as image inference.",
  };
}

export function runSymptomAgent(
  symptomText: string,
  llmSignal?: ContextReasonerSignal | null
): SymptomAgentResult {
  const normalized = symptomText.toLowerCase();
  const extractedSymptoms = RISK_TOKENS.filter((token) => normalized.includes(token));
  const durationDays = normalizeDurationDays(normalized);
  const highRiskPatternHits = countPatternMatches(normalized, HIGH_RISK_CONTEXT_PATTERNS);
  const mediumRiskPatternHits = countPatternMatches(normalized, MEDIUM_RISK_CONTEXT_PATTERNS);
  const reassuringPatternHits = countPatternMatches(normalized, REASSURING_CONTEXT_PATTERNS);

  let severity: "low" | "medium" | "high" = "low";
  if (
    extractedSymptoms.length >= 2 ||
    mediumRiskPatternHits >= 1 ||
    (durationDays !== null && durationDays >= 7)
  ) {
    severity = "medium";
  }
  if (
    extractedSymptoms.includes("fever") ||
    extractedSymptoms.includes("bleeding") ||
    extractedSymptoms.includes("pus") ||
    highRiskPatternHits >= 1 ||
    (durationDays !== null && durationDays >= 21)
  ) {
    severity = "high";
  }
  // Context can de-escalate only if there are no hard red flags.
  const hasHardRedFlags =
    extractedSymptoms.includes("fever") ||
    extractedSymptoms.includes("bleeding") ||
    extractedSymptoms.includes("pus") ||
    highRiskPatternHits >= 1;
  if (!hasHardRedFlags && reassuringPatternHits > 0 && severity !== "low") {
    severity = severity === "high" ? "medium" : "low";
  }
  severity = mergeSeverity(severity, llmSignal?.severityHint ?? null);

  return {
    extractedSymptoms,
    durationDays,
    concernFlags: [
      ...extractedSymptoms,
      ...(highRiskPatternHits ? [`high_risk_context:${highRiskPatternHits}`] : []),
      ...(mediumRiskPatternHits ? [`medium_risk_context:${mediumRiskPatternHits}`] : []),
      ...(reassuringPatternHits ? [`reassuring_context:${reassuringPatternHits}`] : []),
      ...(llmSignal?.concernFlags?.length ? llmSignal.concernFlags.map((f) => `llm:${f}`) : []),
    ],
    severity,
  };
}

// Certain labels are inherently serious — enforce a minimum urgency regardless of confidence.
const URGENCY_FLOOR: Record<string, ConsensusResult["urgency"]> = {
  malignant_or_precancerous:  "urgent",
  "Melanoma Skin Cancer Nevi and Moles": "urgent",
  "Actinic Keratosis Basal Cell Carcinoma and other Malignant Lesions": "urgent",
  infectious_bacterial:       "soon",
  "Cellulitis Impetigo and other Bacterial Infections": "soon",
  autoimmune_bullous:         "soon",
  "Bullous Disease Photos":   "soon",
  infectious_viral_std:       "soon",
  "Herpes HPV and other STDs Photos": "soon",
  autoimmune_connective:      "soon",
  "Lupus and other Connective Tissue diseases": "soon",
  systemic_manifestation:     "soon",
  "Systemic Disease":         "soon",
};

const URGENCY_RANK: Record<ConsensusResult["urgency"], number> = {
  clear: 0, monitor: 1, soon: 2, urgent: 3,
};

function maxUrgency(
  a: ConsensusResult["urgency"],
  b: ConsensusResult["urgency"]
): ConsensusResult["urgency"] {
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b;
}

function bumpUrgency(
  u: ConsensusResult["urgency"],
  steps: number
): ConsensusResult["urgency"] {
  const tiers: ConsensusResult["urgency"][] = ["clear", "monitor", "soon", "urgent"];
  const idx = Math.min(tiers.length - 1, URGENCY_RANK[u] + steps);
  return tiers[idx];
}

export function runTriageAgent(
  vision: VisionAgentResult,
  symptoms: SymptomAgentResult,
  colors?: ColorFeatures | null
): ConsensusResult {
  const hasVisionModel = vision.label !== "model-unavailable";
  // Accept normal_skin at a lower bar — it's the safe default
  const isNormalSkin = vision.label === "normal_skin" && vision.confidence >= 0.45;
  const hasSymptomRisk =
    symptoms.severity !== "low" ||
    symptoms.concernFlags.some((flag) => !flag.startsWith("reassuring_context:")) ||
    (symptoms.durationDays !== null && symptoms.durationDays >= 3);

  // Short-circuit to all-clear only if model is confident this is normal skin
  // AND colors don't show inflammation AND no symptom risk
  const isAngryRed = (colors?.redScore ?? 0) > 0.25;
  if (isNormalSkin && !hasSymptomRisk && !isAngryRed) {
    return {
      condition: "normal_skin",
      confidence: vision.confidence,
      urgency: "clear",
      whenToSeeDoctor: "No issues detected. Keep an eye on the area and see a doctor if anything changes.",
      explanation: "The on-device model compared your photo against 16 skin categories and is confident the skin appears normal.",
    };
  }

  const combinedSeverity = levelFromRank(
    Math.max(severityRank(vision.severity), severityRank(symptoms.severity))
  );

  let urgency: ConsensusResult["urgency"] = "monitor";
  let whenToSeeDoctor = "Keep an eye on this area. Re-scan if it changes.";

  if (combinedSeverity === "medium") {
    urgency = "soon";
    whenToSeeDoctor = "Book a non-urgent doctor visit within 1–3 days.";
  }
  if (combinedSeverity === "high") {
    urgency = "urgent";
    whenToSeeDoctor = "Seek urgent care today, especially if fever, pain, or rapid spreading is present.";
  }

  // ── Three-tier conviction system ──────────────────────────────────────────
  // Default is ALWAYS clear/normal skin. Only override when the model is very confident.
  // A normal arm can score 60-70% on a disease by chance — thresholds must be high.
  const CONVICTION  = 0.88;  // ≥88%: model is very convinced — show disease + full urgency
  const POSSIBLE    = 0.75;  // 75–88%: reasonable signal — show "Possibly X" + mild urgency
  // <75%: model is not convinced — default to clear (no condition found)

  const isDisease = hasVisionModel && vision.label !== "normal_skin";
  const modelConvinced = isDisease && vision.confidence >= CONVICTION;
  const modelPossible  = isDisease && vision.confidence >= POSSIBLE && vision.confidence < CONVICTION;
  const modelUncertain = isDisease && vision.confidence < POSSIBLE;

  // Default to clear when model isn't convinced AND no symptom risk
  if (modelUncertain && !hasSymptomRisk) {
    return {
      condition: "normal_skin",
      confidence: 0.85,
      urgency: "clear",
      whenToSeeDoctor: "Nothing obvious detected. Re-scan in better lighting if you notice changes.",
      explanation: "Model confidence was too low to identify a specific condition — defaulting to no condition found.",
    };
  }

  // Possible detection: drop urgency to monitor minimum, don't escalate
  if (modelPossible) {
    urgency = urgency === "urgent" ? "soon" : urgency === "soon" ? "monitor" : "monitor";
    whenToSeeDoctor = "This may warrant monitoring — re-scan in a few days or consult a doctor if it persists.";
  }

  // ── Label-based urgency floor (only when model is convinced) ─────────────
  if (modelConvinced) {
    const floor = URGENCY_FLOOR[vision.label] ?? null;
    if (floor) {
      urgency = maxUrgency(urgency, floor);
      if (floor === "urgent") {
        whenToSeeDoctor = "This type of condition should be evaluated by a dermatologist promptly — please see a doctor today.";
      } else if (floor === "soon" && URGENCY_RANK[urgency] >= URGENCY_RANK["soon"]) {
        whenToSeeDoctor = "This condition typically warrants a doctor visit within 1–3 days.";
      }
    }
  }

  // ── Color-aware urgency boost (only when model is at least possible) ──────
  if ((modelConvinced || modelPossible) && colors) {
    const { redScore = 0, darkScore = 0 } = colors;

    if (redScore > 0.60) {
      urgency = maxUrgency(urgency, bumpUrgency(urgency, 2));
      whenToSeeDoctor = "Significant redness detected — this level of inflammation warrants same-day or next-day care.";
    } else if (redScore > 0.30) {
      urgency = maxUrgency(urgency, bumpUrgency(urgency, 1));
    }

    if (darkScore > 0.15 && vision.label === "malignant_or_precancerous") {
      urgency = "urgent";
      whenToSeeDoctor = "Dark pigmented area detected alongside a potentially serious label — see a dermatologist today.";
    }
  }

  const confidence = hasVisionModel
    ? Math.min(0.95, Math.max(0.2, vision.confidence + symptoms.concernFlags.length * 0.03))
    : Math.min(0.7, 0.25 + symptoms.concernFlags.length * 0.06);

  // Prefix "possible:" for medium-confidence detections — UI shows "Possibly Eczema / Dermatitis"
  const condition = modelPossible
    ? `possible:${vision.label}`
    : hasVisionModel
      ? vision.label
      : combinedSeverity === "high"
        ? "Possible infection or severe inflammation"
        : combinedSeverity === "medium"
          ? "Possible dermatitis or progressing inflammatory condition"
          : "normal_skin";

  let colorNote = "";
  if (colors && isDisease) {
    if (colors.redScore > 0.30) colorNote = ` Significant redness detected (${(colors.redScore * 100).toFixed(0)}% of pixels).`;
    else if (colors.darkScore > 0.15) colorNote = ` Dark pigmented area detected.`;
  }

  return {
    condition,
    confidence,
    urgency,
    whenToSeeDoctor,
    explanation:
      hasVisionModel
        ? `Decision combines visual model signal with user context and color analysis.${colorNote}`
        : "Decision is currently symptom-only because image model inference is unavailable.",
  };
}

export function runLocalAgentPipeline(
  symptomText: string,
  modelPrediction?: VisionModelPrediction | null,
  colors?: ColorFeatures | null
): LocalAgentOutput {
  const vision = runVisionAgent(modelPrediction);
  const symptoms = runSymptomAgent(symptomText);
  const consensus = runTriageAgent(vision, symptoms, colors);

  const trace: AgentTrace[] = [
    {
      agent: "vision-agent",
      message:
        vision.label === "model-unavailable"
          ? "Model inference unavailable. Check dev-build runtime and Melange/TFLite loading."
          : `Detected ${vision.label} with ${(vision.confidence * 100).toFixed(0)}% confidence (severity: ${vision.severity}).`,
    },
    {
      agent: "symptom-agent",
      message: symptoms.concernFlags.length
        ? `Context signals: ${symptoms.concernFlags.join(", ")}.`
        : "No high-risk symptom or context signals detected.",
    },
    {
      agent: "triage-agent",
      message: `Consensus urgency: ${consensus.urgency}. Recommendation: ${consensus.whenToSeeDoctor}`,
    },
  ];

  return { vision, symptoms, consensus, trace };
}

export async function runLocalAgentPipelineAsync(
  symptomText: string,
  modelPrediction?: VisionModelPrediction | null,
  colors?: ColorFeatures | null
): Promise<LocalAgentOutput> {
  const llmSignal = await reasonSymptomContextOnDevice(symptomText);
  const vision = runVisionAgent(modelPrediction);
  const symptoms = runSymptomAgent(symptomText, llmSignal);
  const consensus = runTriageAgent(vision, symptoms, colors);

  const trace: AgentTrace[] = [
    {
      agent: "vision-agent",
      message:
        vision.label === "model-unavailable"
          ? "Model inference unavailable. Check dev-build runtime and Melange/TFLite loading."
          : `Detected ${vision.label} with ${(vision.confidence * 100).toFixed(0)}% confidence (severity: ${vision.severity}).`,
    },
    {
      agent: "symptom-agent",
      message: symptoms.concernFlags.length
        ? `Context signals: ${symptoms.concernFlags.join(", ")}.`
        : "No high-risk symptom or context signals detected.",
    },
    {
      agent: "triage-agent",
      message: llmSignal
        ? `Consensus urgency: ${consensus.urgency}. On-device LLM context enabled. Recommendation: ${consensus.whenToSeeDoctor}`
        : `Consensus urgency: ${consensus.urgency}. Recommendation: ${consensus.whenToSeeDoctor}`,
    },
  ];

  return { vision, symptoms, consensus, trace };
}
