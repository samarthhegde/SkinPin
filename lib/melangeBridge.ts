import { NativeModules } from "react-native";

export type VisionModelPrediction = {
  label: string;
  confidence: number;
  margin: number;
  topK: { label: string; confidence: number }[];
  source: "melange";
};

const DERMA23_LABELS = [
  "Acne and Rosacea Photos",
  "Actinic Keratosis Basal Cell Carcinoma and other Malignant Lesions",
  "Atopic Dermatitis Photos",
  "Bullous Disease Photos",
  "Cellulitis Impetigo and other Bacterial Infections",
  "Eczema Photos",
  "Exanthems and Drug Eruptions",
  "Hair Loss Photos Alopecia and other Hair Diseases",
  "Herpes HPV and other STDs Photos",
  "Light Diseases and Disorders of Pigmentation",
  "Lupus and other Connective Tissue diseases",
  "Melanoma Skin Cancer Nevi and Moles",
  "Nail Fungus and other Nail Disease",
  "Poison Ivy Photos and other Contact Dermatitis",
  "Psoriasis pictures Lichen Planus and related diseases",
  "Scabies Lyme Disease and other Infestations and Bites",
  "Seborrheic Keratoses and other Benign Tumors",
  "Systemic Disease",
  "Tinea Ringworm Candidiasis and other Fungal Infections",
  "Urticaria Hives",
  "Vascular Tumors",
  "Vasculitis Photos",
  "Warts Molluscum and other Viral Infections",
];

const REDUCED16_LABELS = [
  "inflammatory",
  "malignant_or_precancerous",
  "eczema_dermatitis",
  "autoimmune_bullous",
  "infectious_bacterial",
  "hair_nail_disorder",
  "infectious_viral_std",
  "pigment_light_disorder",
  "autoimmune_connective",
  "papulosquamous",
  "infestation_bite",
  "benign_tumor",
  "systemic_manifestation",
  "infectious_fungal",
  "vascular",
  "normal_skin",
];

// ── Native module access ───────────────────────────────────────────────────────

// Custom Swift bridge (SkinPinZeticBridge.swift) — takes photoUri directly.
type SkinPinZeticModule = {
  create: (personalKey: string, modelKey: string) => Promise<void>;
  runInference: (photoUri: string) => Promise<number[][]>;
};

// Legacy npm package bridge — passes pre-processed pixel arrays.
type ZeticModelClient = {
  create: (personalToken: string, modelKey: string) => Promise<unknown>;
  run: (inputs: unknown[]) => Promise<unknown>;
};

function getCustomBridge(): SkinPinZeticModule | null {
  try {
    const mod = NativeModules.SkinPinZetic as SkinPinZeticModule | undefined;
    return mod ?? null;
  } catch {
    return null;
  }
}

function getLegacyZeticModel(): ZeticModelClient | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("react-native-zetic-mlange");
    return (pkg?.ZeticModel as ZeticModelClient | undefined) ?? null;
  } catch {
    return null;
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

let customBridgeInitialized = false;
let legacyBridgeInitialized = false;

// ZETIC uses the dev key for on-device inference (shown in deployment guide).
// Personal access token is a fallback in case dev key isn't set.
const DEV_KEY = process.env.EXPO_PUBLIC_ZETIC_DEV_KEY ?? "";
const PERSONAL_TOKEN = process.env.EXPO_PUBLIC_ZETIC_PERSONAL_TOKEN ?? "";
const MODEL_NAME = process.env.EXPO_PUBLIC_ZETIC_MODEL_KEY ?? "rashwak674/skinpin";

// ── Helpers ───────────────────────────────────────────────────────────────────

function labelsForOutputSize(size: number): string[] {
  if (size === REDUCED16_LABELS.length) return REDUCED16_LABELS;
  return DERMA23_LABELS;
}

function argmax(scores: number[]): number {
  let bestIdx = 0;
  let best = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < scores.length; i += 1) {
    if (scores[i] > best) { best = scores[i]; bestIdx = i; }
  }
  return bestIdx;
}

function topK(scores: number[], k: number): { index: number; confidence: number }[] {
  return scores
    .map((c, i) => ({ index: i, confidence: c }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.max(1, k));
}

function softmax(logits: number[]): number[] {
  let maxVal = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < logits.length; i += 1) maxVal = Math.max(maxVal, logits[i]);
  const exps = new Array<number>(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i += 1) {
    const val = Math.exp(logits[i] - maxVal);
    exps[i] = val;
    sum += val;
  }
  for (let i = 0; i < exps.length; i += 1) exps[i] /= sum || 1;
  return exps;
}

// The ZETIC/ONNX model has a built-in Softmax op, so its output is already probabilities.
// Applying softmax again crushes confidence. Use temperature scaling instead:
// convert back to log-space, divide by T (T<1 sharpens), re-softmax.
function temperatureScale(probs: number[], temperature = 0.5): number[] {
  let sumProbs = 0;
  for (let i = 0; i < probs.length; i += 1) sumProbs += probs[i];
  const isProbability = Math.abs(sumProbs - 1.0) < 0.1;

  if (!isProbability) {
    // Raw logits — temperature-scaled softmax
    const scaled = probs.map((v) => v / temperature);
    return softmax(scaled);
  }

  // Already probabilities — back to log-space, scale, re-softmax
  const logits = probs.map((p) => Math.log(Math.max(p, 1e-10)) / temperature);
  return softmax(logits);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "number");
}

function collectNumberArrays(value: unknown, out: number[][]): void {
  if (!value) return;
  if (isNumberArray(value)) { out.push(value); return; }
  if (value instanceof ArrayBuffer) {
    out.push(Array.from(new Float32Array(value)));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumberArrays(item, out);
    return;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["output", "outputs", "data", "tensor", "tensors", "result", "results"]) {
      if (key in record) collectNumberArrays(record[key], out);
    }
    for (const nestedValue of Object.values(record)) collectNumberArrays(nestedValue, out);
  }
}

function extractScores(raw: unknown): number[] | null {
  const candidates: number[][] = [];
  collectNumberArrays(raw, candidates);
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.length - a.length);
  const wide = candidates.find((arr) => arr.length > 5);
  return wide ?? candidates[0];
}

function scoresToPrediction(rawScores: number[]): VisionModelPrediction | null {
  if (!rawScores.length) return null;

  // Determine if output is logits or already softmax probabilities.
  const sumRaw = rawScores.reduce((a, b) => a + b, 0);
  const isLogits = Math.abs(sumRaw - 1.0) > 0.15;

  let scores: number[];
  if (isLogits) {
    // ZETIC post-optimization returns raw logits — T=1.3 gives a slightly flatter distribution
    // without nuking genuine high-confidence disease predictions.
    scores = softmax(rawScores.map((v) => v / 1.3));
  } else {
    // Already probabilities — T=1.3 moderately flattens overconfidence.
    scores = temperatureScale(rawScores, 1.3);
  }

  const labels = labelsForOutputSize(scores.length);
  const bestIdx = argmax(scores);
  const label = labels[bestIdx] ?? `class_${bestIdx}`;
  const confidence = scores[bestIdx] ?? 0;
  const topPredictions = topK(scores, 3).map((e) => ({
    label: labels[e.index] ?? `class_${e.index}`,
    confidence: e.confidence,
  }));
  const margin = topPredictions.length > 1
    ? topPredictions[0].confidence - topPredictions[1].confidence
    : topPredictions[0].confidence;
  return { label, confidence, margin, topK: topPredictions, source: "melange" };
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initializeMelangeBridge(): Promise<boolean> {
  if (customBridgeInitialized || legacyBridgeInitialized) return true;

  // Try dev key first (used in ZETIC deployment guide for inference), then personal token.
  const keysToTry: string[] = [];
  if (DEV_KEY) keysToTry.push(DEV_KEY);
  if (PERSONAL_TOKEN && PERSONAL_TOKEN !== DEV_KEY) keysToTry.push(PERSONAL_TOKEN);
  if (!keysToTry.length) {
    console.warn("[Melange] No API keys found — set EXPO_PUBLIC_ZETIC_DEV_KEY or EXPO_PUBLIC_ZETIC_PERSONAL_TOKEN");
    return false;
  }

  const attempts: { token: string; key: string }[] = keysToTry.map((token) => ({
    token,
    key: MODEL_NAME,
  }));

  // 1. Try custom Swift bridge (SkinPinZeticBridge) — preferred, uses latest ZeticMLange framework.
  const customBridge = getCustomBridge();
  if (customBridge) {
    for (const { token, key } of attempts) {
      try {
        console.log("[Melange] Custom bridge — token:", token.slice(0, 10) + "...", "key:", key);
        await customBridge.create(token, key);
        customBridgeInitialized = true;
        console.log("[Melange] Custom bridge initialized — token:", token.slice(0, 10) + "...", "key:", key);
        return true;
      } catch (e) {
        console.warn("[Melange] Custom bridge failed — token:", token.slice(0, 10) + "...", "key:", key, e);
      }
    }
  } else {
    console.warn("[Melange] SkinPinZetic native module not found — needs rebuild");
  }

  // 2. Fall back to legacy react-native-zetic-mlange npm package.
  const legacyModel = getLegacyZeticModel();
  if (legacyModel) {
    for (const { token, key } of attempts) {
      try {
        console.log("[Melange] Legacy bridge — token:", token.slice(0, 10) + "...", "key:", key);
        await legacyModel.create(token, key);
        legacyBridgeInitialized = true;
        console.log("[Melange] Legacy bridge initialized — token:", token.slice(0, 10) + "...", "key:", key);
        return true;
      } catch (e) {
        console.warn("[Melange] Legacy bridge failed — token:", token.slice(0, 10) + "...", "key:", key, e);
      }
    }
  }

  console.error("[Melange] All initialization attempts failed.");
  return false;
}

// ── Inference ─────────────────────────────────────────────────────────────────

export async function analyzeSkinPhotoWithMelange(
  photoUri: string
): Promise<VisionModelPrediction | null> {
  // Path 1: custom Swift bridge — handles everything natively.
  if (customBridgeInitialized) {
    const customBridge = getCustomBridge();
    if (customBridge) {
      try {
        const rawOutput = await customBridge.runInference(photoUri);
        console.log("[Melange] Custom bridge raw output shape:", rawOutput?.length, rawOutput?.[0]?.length);
        const rawScores = extractScores(rawOutput);
        if (rawScores && rawScores.length > 0) return scoresToPrediction(rawScores);
      } catch (e) {
        console.warn("[Melange] Custom bridge inference failed:", e);
      }
    }
  }

  // Path 2: legacy npm package bridge — JS-side image preprocessing.
  if (legacyBridgeInitialized) {
    const legacyModel = getLegacyZeticModel();
    if (legacyModel) {
      try {
        // Lazy-load heavy image libs only when needed.
        const FileSystem = await import("expo-file-system/legacy");
        const { toByteArray } = await import("base64-js");
        const jpeg = await import("jpeg-js");

        const base64 = await FileSystem.readAsStringAsync(photoUri, { encoding: "base64" as any });
        const jpgBytes = toByteArray(base64);
        const decoded = (jpeg as any).decode(jpgBytes, { useTArray: true });
        if (!decoded?.data || !decoded.width || !decoded.height) return null;

        const MODEL_SIZE = 224;
        const out = new Array<number>(MODEL_SIZE * MODEL_SIZE * 3);
        let idx = 0;
        for (let y = 0; y < MODEL_SIZE; y++) {
          const srcY = Math.floor((y / MODEL_SIZE) * decoded.height);
          for (let x = 0; x < MODEL_SIZE; x++) {
            const srcX = Math.floor((x / MODEL_SIZE) * decoded.width);
            const srcIdx = (srcY * decoded.width + srcX) * 4;
            out[idx++] = decoded.data[srcIdx];
            out[idx++] = decoded.data[srcIdx + 1];
            out[idx++] = decoded.data[srcIdx + 2];
          }
        }

        const rawOutput = await legacyModel.run([out]);
        console.log("[Melange] Legacy raw output type:", typeof rawOutput, Array.isArray(rawOutput));
        const rawScores = extractScores(rawOutput);
        if (rawScores && rawScores.length > 0) return scoresToPrediction(rawScores);
      } catch (e) {
        console.warn("[Melange] Legacy bridge inference failed:", e);
      }
    }
  }

  return null;
}
