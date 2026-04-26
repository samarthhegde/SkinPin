import * as FileSystem from "expo-file-system";
import { toByteArray } from "base64-js";
import jpeg from "jpeg-js";

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

const MODEL_SIZE = 224;

type ZeticModelClient = {
  create: (personalToken: string, modelKey: string) => Promise<unknown>;
  run: (inputs: unknown[]) => Promise<unknown>;
};

let zeticModel: ZeticModelClient | null = null;
let zeticInitialized = false;

function getZeticModelClient(): ZeticModelClient | null {
  if (zeticModel) return zeticModel;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("react-native-zetic-mlange");
    const model = pkg?.ZeticModel as ZeticModelClient | undefined;
    if (!model) return null;
    zeticModel = model;
    return model;
  } catch {
    return null;
  }
}

function labelsForOutputSize(size: number): string[] {
  if (size === REDUCED16_LABELS.length) return REDUCED16_LABELS;
  return DERMA23_LABELS;
}

function argmax(scores: number[]): number {
  let bestIdx = 0;
  let best = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < scores.length; i += 1) {
    if (scores[i] > best) {
      best = scores[i];
      bestIdx = i;
    }
  }
  return bestIdx;
}

function topK(scores: number[], k: number): { index: number; confidence: number }[] {
  const pairs: { index: number; confidence: number }[] = [];
  for (let i = 0; i < scores.length; i += 1) {
    pairs.push({ index: i, confidence: scores[i] });
  }
  pairs.sort((a, b) => b.confidence - a.confidence);
  return pairs.slice(0, Math.max(1, k));
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

function resizeRgbaToRgb224(rgba: Uint8Array, srcWidth: number, srcHeight: number): number[] {
  const out = new Array<number>(MODEL_SIZE * MODEL_SIZE * 3);
  let outIndex = 0;
  for (let y = 0; y < MODEL_SIZE; y += 1) {
    const srcY = Math.floor((y / MODEL_SIZE) * srcHeight);
    for (let x = 0; x < MODEL_SIZE; x += 1) {
      const srcX = Math.floor((x / MODEL_SIZE) * srcWidth);
      const srcIdx = (srcY * srcWidth + srcX) * 4;
      out[outIndex++] = rgba[srcIdx];
      out[outIndex++] = rgba[srcIdx + 1];
      out[outIndex++] = rgba[srcIdx + 2];
    }
  }
  return out;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "number");
}

function typedArrayToNumbers(value: unknown): number[] | null {
  if (!value || typeof value !== "object") return null;
  if (ArrayBuffer.isView(value)) {
    const arr = value as ArrayLike<number>;
    return Array.from({ length: arr.length }, (_, i) => Number(arr[i]));
  }
  if (value instanceof ArrayBuffer) {
    return Array.from(new Float32Array(value));
  }
  return null;
}

function collectNumberArrays(value: unknown, out: number[][]): void {
  if (!value) return;
  if (isNumberArray(value)) {
    out.push(value);
    return;
  }

  const typed = typedArrayToNumbers(value);
  if (typed && typed.length > 0) {
    out.push(typed);
    return;
  }

  if (Array.isArray(value)) {
    const numericStrings = value
      .map((v) => (typeof v === "string" ? Number(v) : Number.NaN))
      .filter((n) => Number.isFinite(n));
    if (numericStrings.length === value.length && numericStrings.length > 0) {
      out.push(numericStrings);
      return;
    }
    for (const item of value) {
      collectNumberArrays(item, out);
    }
    return;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferredKeys = ["output", "outputs", "data", "tensor", "tensors", "result", "results"];
    for (const key of preferredKeys) {
      if (key in record) collectNumberArrays(record[key], out);
    }
    for (const nestedValue of Object.values(record)) {
      collectNumberArrays(nestedValue, out);
    }
  }
}

function extractScores(raw: unknown): number[] | null {
  const candidates: number[][] = [];
  collectNumberArrays(raw, candidates);
  if (!candidates.length) return null;

  // Pick the most classification-like vector: prefer wider vectors (>5 classes).
  candidates.sort((a, b) => b.length - a.length);
  const wide = candidates.find((arr) => arr.length > 5);
  return wide ?? candidates[0];
}

export async function initializeMelangeBridge(): Promise<boolean> {
  if (zeticInitialized) return true;

  const model = getZeticModelClient();
  if (!model) return false;

  const token = process.env.EXPO_PUBLIC_ZETIC_PERSONAL_TOKEN;
  const modelKey = process.env.EXPO_PUBLIC_ZETIC_MODEL_KEY;
  if (!token || !modelKey) return false;

  try {
    await model.create(token, modelKey);
    zeticInitialized = true;
    return true;
  } catch {
    return false;
  }
}

export async function analyzeSkinPhotoWithMelange(
  photoUri: string
): Promise<VisionModelPrediction | null> {
  if (!zeticInitialized) return null;
  const model = getZeticModelClient();
  if (!model) return null;

  try {
    const base64 = await FileSystem.readAsStringAsync(photoUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const jpgBytes = toByteArray(base64);
    const decoded = jpeg.decode(jpgBytes, { useTArray: true });
    if (!decoded?.data || !decoded.width || !decoded.height) return null;

    const inputData = resizeRgbaToRgb224(decoded.data, decoded.width, decoded.height);
    const rawOutput = await model.run([inputData]);
    console.log("[Melange] raw output type:", typeof rawOutput, Array.isArray(rawOutput));
    const rawScores = extractScores(rawOutput);
    if (!rawScores || rawScores.length === 0) return null;

    const scores = softmax(rawScores);
    const labels = labelsForOutputSize(scores.length);
    const bestIdx = argmax(scores);
    const label = labels[bestIdx] ?? `class_${bestIdx}`;
    const confidence = scores[bestIdx] ?? 0;

    const topPredictions = topK(scores, 3).map((entry) => ({
      label: labels[entry.index] ?? `class_${entry.index}`,
      confidence: entry.confidence,
    }));
    const margin =
      topPredictions.length > 1
        ? topPredictions[0].confidence - topPredictions[1].confidence
        : topPredictions[0].confidence;

    return { label, confidence, margin, topK: topPredictions, source: "melange" };
  } catch {
    return null;
  }
}
