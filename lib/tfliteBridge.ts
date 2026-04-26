import * as FileSystem from "expo-file-system";
import { toByteArray } from "base64-js";
import jpeg from "jpeg-js";

export type VisionModelPrediction = {
  label: string;
  confidence: number;
  margin: number;
  topK: { label: string; confidence: number }[];
  source: "tflite";
};

type TfliteTensor = {
  shape: number[];
  dataType: string;
};

type TfliteModel = {
  inputs: TfliteTensor[];
  outputs: TfliteTensor[];
  runSync: (input: ArrayBuffer[]) => ArrayBuffer[];
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

let tfliteModel: TfliteModel | null = null;
let bridgeInitAttempted = false;
let hasFastTflite = true;

function argmax(scores: Float32Array): number {
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

function topK(scores: Float32Array, k: number): { index: number; confidence: number }[] {
  const pairs: { index: number; confidence: number }[] = [];
  for (let i = 0; i < scores.length; i += 1) {
    pairs.push({ index: i, confidence: scores[i] });
  }
  pairs.sort((a, b) => b.confidence - a.confidence);
  return pairs.slice(0, Math.max(1, k));
}

function softmax(logits: Float32Array): Float32Array {
  let maxVal = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < logits.length; i += 1) maxVal = Math.max(maxVal, logits[i]);
  const exps = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i += 1) {
    const val = Math.exp(logits[i] - maxVal);
    exps[i] = val;
    sum += val;
  }
  for (let i = 0; i < exps.length; i += 1) exps[i] /= sum || 1;
  return exps;
}

function labelsForOutputSize(size: number): string[] {
  if (size === REDUCED16_LABELS.length) return REDUCED16_LABELS;
  return DERMA23_LABELS;
}

function resizeRgbaToRgb224(
  rgba: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  inputDType: string,
  flipHorizontal = false
): ArrayBuffer {
  const pixelCount = MODEL_SIZE * MODEL_SIZE * 3;

  if (inputDType === "uint8") {
    const out = new Uint8Array(pixelCount);
    let outIndex = 0;
    for (let y = 0; y < MODEL_SIZE; y += 1) {
      const srcY = Math.floor((y / MODEL_SIZE) * srcHeight);
      for (let x = 0; x < MODEL_SIZE; x += 1) {
        const sampleX = flipHorizontal ? MODEL_SIZE - 1 - x : x;
        const srcX = Math.floor((sampleX / MODEL_SIZE) * srcWidth);
        const srcIdx = (srcY * srcWidth + srcX) * 4;
        out[outIndex++] = rgba[srcIdx];
        out[outIndex++] = rgba[srcIdx + 1];
        out[outIndex++] = rgba[srcIdx + 2];
      }
    }
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  }

  const out = new Float32Array(pixelCount);
  let outIndex = 0;
  for (let y = 0; y < MODEL_SIZE; y += 1) {
    const srcY = Math.floor((y / MODEL_SIZE) * srcHeight);
    for (let x = 0; x < MODEL_SIZE; x += 1) {
      const sampleX = flipHorizontal ? MODEL_SIZE - 1 - x : x;
      const srcX = Math.floor((sampleX / MODEL_SIZE) * srcWidth);
      const srcIdx = (srcY * srcWidth + srcX) * 4;
      out[outIndex++] = rgba[srcIdx];
      out[outIndex++] = rgba[srcIdx + 1];
      out[outIndex++] = rgba[srcIdx + 2];
    }
  }
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

export async function initializeTfliteBridge(): Promise<boolean> {
  if (bridgeInitAttempted) return tfliteModel !== null;
  bridgeInitAttempted = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tflitePkg = require("react-native-fast-tflite");
    const loadModel = tflitePkg?.loadTensorflowModel as
      | ((source: number | { url: string }, delegates: string[]) => Promise<TfliteModel>)
      | undefined;

    if (!loadModel) return false;

    tfliteModel = await loadModel(require("../assets/models/derma23.tflite"), []);
    return true;
  } catch {
    hasFastTflite = false;
    tfliteModel = null;
    return false;
  }
}

export function isTfliteRuntimeAvailable(): boolean {
  return hasFastTflite;
}

export async function analyzeSkinPhotoWithTflite(photoUri: string): Promise<VisionModelPrediction | null> {
  if (!tfliteModel) return null;
  if (!photoUri) return null;

  try {
    const base64 = await FileSystem.readAsStringAsync(photoUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const jpgBytes = toByteArray(base64);
    const decoded = jpeg.decode(jpgBytes, { useTArray: true });
    if (!decoded?.data || !decoded.width || !decoded.height) return null;

    const inputDataType = tfliteModel.inputs[0]?.dataType ?? "float32";
    const inputBuffer = resizeRgbaToRgb224(
      decoded.data,
      decoded.width,
      decoded.height,
      inputDataType
    );
    const flippedBuffer = resizeRgbaToRgb224(
      decoded.data,
      decoded.width,
      decoded.height,
      inputDataType,
      true
    );

    const outputs = tfliteModel.runSync([inputBuffer]);
    const outputsFlipped = tfliteModel.runSync([flippedBuffer]);
    if (!outputs.length || !outputs[0] || !outputsFlipped.length || !outputsFlipped[0]) return null;

    const scoresA = new Float32Array(outputs[0]);
    const scoresB = new Float32Array(outputsFlipped[0]);
    if (scoresA.length !== scoresB.length) return null;
    let scores = new Float32Array(scoresA.length);
    for (let i = 0; i < scores.length; i += 1) {
      scores[i] = (scoresA[i] + scoresB[i]) / 2;
    }
    // If model already outputs probabilities, this is still valid for argmax.
    // Applying softmax keeps confidence values interpretable.
    scores = softmax(scores);

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

    return { label, confidence, margin, topK: topPredictions, source: "tflite" };
  } catch {
    return null;
  }
}
