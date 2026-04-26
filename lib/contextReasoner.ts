export type SeverityLevel = "low" | "medium" | "high";

export type ContextReasonerSignal = {
  severityHint: SeverityLevel | null;
  concernFlags: string[];
  rationale?: string;
  source: "ondevice-llm";
};

type LlamaModule = {
  loadLlamaModel?: (options: { model: string; n_ctx?: number }) => Promise<{
    completion: (params: { prompt: string; n_predict?: number; temperature?: number }) => Promise<{
      text?: string;
    }>;
  }>;
};

let cachedModel: Awaited<ReturnType<NonNullable<LlamaModule["loadLlamaModel"]>>> | null = null;
let modelInitAttempted = false;

function parseJsonBlock(text: string): Record<string, unknown> | null {
  const fenceStart = text.indexOf("{");
  const fenceEnd = text.lastIndexOf("}");
  if (fenceStart < 0 || fenceEnd <= fenceStart) return null;
  const maybeJson = text.slice(fenceStart, fenceEnd + 1);
  try {
    const parsed = JSON.parse(maybeJson);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeSeverity(value: unknown): SeverityLevel | null {
  if (value === "low" || value === "medium" || value === "high") return value;
  return null;
}

function normalizeFlags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 6);
}

async function loadOptionalLlamaModel() {
  if (cachedModel) return cachedModel;
  if (modelInitAttempted) return null;
  modelInitAttempted = true;

  const modelPath = process.env.EXPO_PUBLIC_ONDEVICE_LLM_MODEL_PATH;
  const enabled = process.env.EXPO_PUBLIC_ENABLE_ONDEVICE_LLM === "true";
  if (!enabled || !modelPath) return null;

  try {
    // Dynamic require keeps app working when llama.rn is not installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const llama = require("llama.rn") as LlamaModule;
    if (!llama?.loadLlamaModel) return null;
    cachedModel = await llama.loadLlamaModel({ model: modelPath, n_ctx: 1024 });
    return cachedModel;
  } catch {
    return null;
  }
}

export async function reasonSymptomContextOnDevice(
  symptomText: string
): Promise<ContextReasonerSignal | null> {
  const model = await loadOptionalLlamaModel();
  if (!model || !symptomText.trim()) return null;

  const prompt = [
    "You are an on-device triage helper.",
    "Given patient context text, produce strict JSON only.",
    'Schema: {"severityHint":"low|medium|high|null","concernFlags":["short_flag"],"rationale":"brief"}',
    "Rules: identify risk patterns like progression, infection, systemic signs, sensitive area involvement, and duration cues.",
    `Patient context: "${symptomText.replace(/"/g, '\\"')}"`,
  ].join("\n");

  try {
    const result = await model.completion({
      prompt,
      n_predict: 160,
      temperature: 0.1,
    });
    const parsed = parseJsonBlock(result?.text ?? "");
    if (!parsed) return null;

    return {
      severityHint: normalizeSeverity(parsed.severityHint),
      concernFlags: normalizeFlags(parsed.concernFlags),
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : undefined,
      source: "ondevice-llm",
    };
  } catch {
    return null;
  }
}
