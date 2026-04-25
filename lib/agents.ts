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
  urgency: "monitor" | "soon" | "urgent";
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

export function runSymptomAgent(symptomText: string): SymptomAgentResult {
  const normalized = symptomText.toLowerCase();
  const extractedSymptoms = RISK_TOKENS.filter((token) => normalized.includes(token));
  const durationDays = normalizeDurationDays(normalized);

  let severity: "low" | "medium" | "high" = "low";
  if (extractedSymptoms.length >= 2 || (durationDays !== null && durationDays >= 7)) {
    severity = "medium";
  }
  if (
    extractedSymptoms.includes("fever") ||
    extractedSymptoms.includes("bleeding") ||
    extractedSymptoms.includes("pus") ||
    (durationDays !== null && durationDays >= 21)
  ) {
    severity = "high";
  }

  return {
    extractedSymptoms,
    durationDays,
    concernFlags: extractedSymptoms,
    severity,
  };
}

export function runTriageAgent(
  vision: VisionAgentResult,
  symptoms: SymptomAgentResult
): ConsensusResult {
  const hasVisionModel = vision.label !== "model-unavailable" && vision.label !== "uncertain-visual";
  const combinedSeverity = levelFromRank(
    Math.max(severityRank(vision.severity), severityRank(symptoms.severity))
  );

  let urgency: ConsensusResult["urgency"] = "monitor";
  let whenToSeeDoctor = "Monitor for 24-48 hours. Seek care if symptoms worsen.";

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
    ? Math.min(0.95, vision.confidence + symptoms.concernFlags.length * 0.04)
    : Math.min(0.55, 0.25 + symptoms.concernFlags.length * 0.07);

  const condition =
    vision.label === "uncertain-visual"
      ? "Uncertain visual classification"
      : hasVisionModel
        ? `Likely ${vision.label}`
        : combinedSeverity === "high"
          ? "Possible infection or severe inflammation"
          : combinedSeverity === "medium"
            ? "Possible dermatitis or progressing inflammatory condition"
            : "Likely mild irritation";

  return {
    condition,
    confidence,
    urgency,
    whenToSeeDoctor,
    explanation:
      hasVisionModel
        ? "Decision combines visual model signal and symptom risk factors using local multi-agent consensus."
        : vision.label === "uncertain-visual"
          ? "Decision uses symptoms with uncertainty-aware visual fallback because image confidence was low."
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
        ? `Extracted risk symptoms: ${symptoms.concernFlags.join(", ")}.`
        : "No high-risk symptom tokens detected.",
    },
    {
      agent: "triage-agent",
      message: `Consensus urgency: ${consensus.urgency}. Recommendation: ${consensus.whenToSeeDoctor}`,
    },
  ];

  return { vision, symptoms, consensus, trace };
}
