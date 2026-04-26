import { ContextReasonerSignal, reasonSymptomContextOnDevice } from "@/lib/contextReasoner";

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
    const isUncertain = modelPrediction.confidence < 0.45 || modelPrediction.margin < 0.1;
    if (isUncertain) {
      return {
        label: "uncertain-visual",
        confidence: modelPrediction.confidence,
        severity: "low",
        rationale:
          "Model confidence/margin is low, so visual classification is uncertain and requires cautious triage.",
      };
    }

    const severity: "low" | "medium" | "high" =
      modelPrediction.confidence >= 0.85
        ? "high"
        : modelPrediction.confidence >= 0.65
          ? "medium"
          : "low";

    return {
      label: modelPrediction.label,
      confidence: modelPrediction.confidence,
      severity,
        rationale: `On-device model predicted "${modelPrediction.label}" from captured skin image.`,
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

export function runTriageAgent(
  vision: VisionAgentResult,
  symptoms: SymptomAgentResult
): ConsensusResult {
  const hasVisionModel = vision.label !== "model-unavailable" && vision.label !== "uncertain-visual";
  const isNormalSkin = vision.label === "normal_skin" && vision.confidence >= 0.70;
  const hasSymptomRisk =
    symptoms.severity !== "low" ||
    symptoms.concernFlags.some((flag) => !flag.startsWith("reassuring_context:")) ||
    (symptoms.durationDays !== null && symptoms.durationDays >= 3);

    // If gate model is confident this is normal skin, short-circuit to all-clear
    if (isNormalSkin && !hasSymptomRisk) {
      return {
        condition: "No skin condition found",
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
  let whenToSeeDoctor = "No issues detected. Keep an eye on the area and see a doctor if anything changes.";

  if (combinedSeverity === "medium") {
    urgency = "soon";
    whenToSeeDoctor = "Book a non-urgent doctor visit within 1-3 days.";
  }
  if (combinedSeverity === "high") {
    urgency = "urgent";
    whenToSeeDoctor = "Seek urgent care today, especially if fever/pain/spreading is present.";
  }
  if (vision.label === "uncertain-visual") {
    urgency = urgency === "monitor" ? "soon" : urgency;
    whenToSeeDoctor =
      "Visual model is uncertain. Re-capture in better lighting and consider clinician review within 24-48 hours.";
  }

  const confidence = hasVisionModel
    ? Math.min(0.95, Math.max(0.2, vision.confidence + symptoms.concernFlags.length * 0.03))
    : Math.min(0.7, 0.25 + symptoms.concernFlags.length * 0.06);

  const condition =
    vision.label === "uncertain-visual"
      ? "Uncertain visual classification"
      : hasVisionModel
        ? `Likely ${vision.label}`
        : combinedSeverity === "high"
          ? "Possible infection or severe inflammation"
          : combinedSeverity === "medium"
            ? "Possible dermatitis or progressing inflammatory condition"
            : "No confident visual condition detected";

  return {
    condition,
    confidence,
    urgency,
    whenToSeeDoctor,
    explanation:
      hasVisionModel
        ? "Decision combines visual model signal with user context (symptoms, progression, duration, and risk phrases) using local multi-agent consensus."
        : vision.label === "uncertain-visual"
          ? "Decision uses user context with uncertainty-aware visual fallback because image confidence was low."
          : "Decision is currently symptom-only because image model inference is unavailable.",
  };
}

export function runLocalAgentPipeline(
  symptomText: string,
  modelPrediction?: VisionModelPrediction | null
): LocalAgentOutput {
  const vision = runVisionAgent(modelPrediction);
  const symptoms = runSymptomAgent(symptomText);
  const consensus = runTriageAgent(vision, symptoms);

  const trace: AgentTrace[] = [
    {
      agent: "vision-agent",
      message:
        vision.label === "model-unavailable"
          ? "Model inference unavailable. Check dev-build runtime and Melange/TFLite loading."
          : vision.label === "uncertain-visual"
            ? "Model ran but confidence/margin is low; marking visual result as uncertain."
          : `Detected ${vision.label} with ${(vision.confidence * 100).toFixed(0)}% confidence.`,
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
  modelPrediction?: VisionModelPrediction | null
): Promise<LocalAgentOutput> {
  const llmSignal = await reasonSymptomContextOnDevice(symptomText);
  const vision = runVisionAgent(modelPrediction);
  const symptoms = runSymptomAgent(symptomText, llmSignal);
  const consensus = runTriageAgent(vision, symptoms);

  const trace: AgentTrace[] = [
    {
      agent: "vision-agent",
      message:
        vision.label === "model-unavailable"
          ? "Model inference unavailable. Check dev-build runtime and Melange/TFLite loading."
          : vision.label === "uncertain-visual"
            ? "Model ran but confidence/margin is low; marking visual result as uncertain."
            : `Detected ${vision.label} with ${(vision.confidence * 100).toFixed(0)}% confidence.`,
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
