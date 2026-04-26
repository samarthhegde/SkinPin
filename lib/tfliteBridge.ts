import * as FileSystem from "expo-file-system/legacy";
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

let tfliteModel: TfliteModel | null = null;       // 23-class disease model
let gateModel: TfliteModel | null = null;          // 16-class v2 model (has normal_skin)
let bridgeInitAttempted = false;
let hasFastTflite = true;

// Default is normal/clear skin. Only override to a disease when the disease model
// is very confident AND the gate model isn't calling it normal skin.
const NORMAL_SKIN_THRESHOLD = 0.10;           // gate model ≥10% on normal_skin triggers check
const NORMAL_SKIN_MARGIN_THRESHOLD = 0.05;   // gate needs only a small margin over 2nd class
const DISEASE_LOW_CONFIDENCE_THRESHOLD = 0.75; // disease model must be ≥75% to override gate

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

// The model already has a final Softmax layer, so its output is probabilities (0–1, sum≈1).
// Applying softmax again flattens/crushes confidence. Instead, convert back to log-space
// and apply temperature scaling (T<1 sharpens; T=0.5 turns 35% → ~77%).
function temperatureScale(probs: Float32Array, temperature = 0.5): Float32Array {
  let sumProbs = 0;
  for (let i = 0; i < probs.length; i += 1) sumProbs += probs[i];
  const isProbability = Math.abs(sumProbs - 1.0) < 0.1;

  if (!isProbability) {
    // Raw logits — standard softmax with temperature
    const scaled = new Float32Array(probs.length);
    for (let i = 0; i < probs.length; i += 1) scaled[i] = probs[i] / temperature;
    return softmax(scaled);
  }

  // Already probabilities — go back to log-space, scale, re-softmax
  const logits = new Float32Array(probs.length);
  for (let i = 0; i < probs.length; i += 1) {
    logits[i] = Math.log(Math.max(probs[i], 1e-10)) / temperature;
  }
  return softmax(logits);
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
  if (bridgeInitAttempted) {
    console.log("[TFLite] Already attempted — tfliteModel:", !!tfliteModel, "gateModel:", !!gateModel);
    return tfliteModel !== null || gateModel !== null;
  }
  bridgeInitAttempted = true;
  console.log("[TFLite] Starting initialization…");

  let tflitePkg: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    tflitePkg = require("react-native-fast-tflite");
    console.log("[TFLite] Package loaded, keys:", Object.keys(tflitePkg ?? {}));
  } catch (e) {
    console.error("[TFLite] require() failed — native module not linked:", e);
    hasFastTflite = false;
    return false;
  }

  const loadModel = tflitePkg?.loadTensorflowModel as
    | ((source: number | { url: string }, delegates: string[]) => Promise<TfliteModel>)
    | undefined;

  if (!loadModel) {
    console.error("[TFLite] loadTensorflowModel not found in package");
    return false;
  }

  try {
    console.log("[TFLite] Loading derma23.tflite and condition_v2.tflite…");
    const [m23, mv2] = await Promise.all([
      loadModel(require("../assets/models/derma23.tflite"), []).catch((e: unknown) => {
        console.error("[TFLite] derma23.tflite load failed:", e);
        return null;
      }),
      loadModel(require("../assets/models/condition_v2.tflite"), []).catch((e: unknown) => {
        console.error("[TFLite] condition_v2.tflite load failed:", e);
        return null;
      }),
    ]);

    tfliteModel = m23;
    gateModel = mv2;

    console.log("[TFLite] Init complete — disease model:", !!tfliteModel, "gate model:", !!gateModel);
    return tfliteModel !== null || gateModel !== null;
  } catch (e) {
    console.error("[TFLite] Unexpected error during model load:", e);
    hasFastTflite = false;
    tfliteModel = null;
    gateModel = null;
    return false;
  }
}

export function isTfliteRuntimeAvailable(): boolean {
  return hasFastTflite;
}

// Run one model on pre-decoded RGBA data and return softmax scores
function runModelOnDecoded(
  model: TfliteModel,
  rgbaData: Uint8Array,
  width: number,
  height: number
): Float32Array | null {
  try {
    const dtype = model.inputs[0]?.dataType ?? "float32";
    console.log("[TFLite] runModelOnDecoded — dtype:", dtype, "input shape:", model.inputs[0]?.shape);
    const buf = resizeRgbaToRgb224(rgbaData, width, height, dtype);
    const bufFlipped = resizeRgbaToRgb224(rgbaData, width, height, dtype, true);
    const out = model.runSync([buf]);
    const outFlipped = model.runSync([bufFlipped]);
    if (!out[0] || !outFlipped[0]) {
      console.error("[TFLite] runSync returned empty output", { hasOut: !!out[0], hasFlipped: !!outFlipped[0] });
      return null;
    }
    const a = new Float32Array(out[0]);
    const b = new Float32Array(outFlipped[0]);
    if (a.length !== b.length) {
      console.error("[TFLite] output length mismatch", a.length, b.length);
      return null;
    }
    const avg = new Float32Array(a.length);
    for (let i = 0; i < avg.length; i++) avg[i] = (a[i] + b[i]) / 2;
    // Temperature-scale instead of double-softmax. T=1.3 slightly flattens overconfident
    // outputs without destroying real high-confidence disease predictions.
    return temperatureScale(avg, 1.3);
  } catch (e) {
    console.error("[TFLite] runModelOnDecoded threw:", e);
    return null;
  }
}

export async function analyzeSkinPhotoWithTflite(photoUri: string): Promise<VisionModelPrediction | null> {
  if (!tfliteModel && !gateModel) {
    console.warn("[TFLite] analyze called but no models loaded");
    return null;
  }
  if (!photoUri) {
    console.warn("[TFLite] analyze called with empty photoUri");
    return null;
  }

  try {
    console.log("[TFLite] Reading photo:", photoUri);
    const base64 = await FileSystem.readAsStringAsync(photoUri, {
      encoding: "base64" as any,
    });
    console.log("[TFLite] base64 length:", base64?.length);
    const jpgBytes = toByteArray(base64);
    const decoded = jpeg.decode(jpgBytes, { useTArray: true });
    console.log("[TFLite] decoded jpg:", decoded?.width, "x", decoded?.height, "bytes:", decoded?.data?.length);
    if (!decoded?.data || !decoded.width || !decoded.height) {
      console.error("[TFLite] jpeg decode failed");
      return null;
    }

    // ── STAGE 1: Gate model (16-class, has normal_skin) ──────────────────
    let gateNormalConf = 0;
    let gateNormalMargin = 0;
    let gateTopPredictions: { label: string; confidence: number }[] = [];
    if (gateModel) {
      const gateScores = runModelOnDecoded(gateModel, decoded.data, decoded.width, decoded.height);
      if (gateScores) {
        const normalIdx = REDUCED16_LABELS.indexOf("normal_skin");
        gateNormalConf = normalIdx >= 0 ? (gateScores[normalIdx] ?? 0) : 0;
        gateTopPredictions = topK(gateScores, 3).map((e) => ({
          label: REDUCED16_LABELS[e.index] ?? `class_${e.index}`,
          confidence: e.confidence,
        }));
        gateNormalMargin =
          gateTopPredictions.length > 1
            ? gateTopPredictions[0].confidence - gateTopPredictions[1].confidence
            : gateTopPredictions[0]?.confidence ?? 0;
      }
    }

    // ── STAGE 2: Disease model (23-class, specific conditions) ───────────
    // If only the gate model is available, use its 16-class prediction directly.
    if (!tfliteModel) {
      if (gateTopPredictions.length > 0) {
        const top = gateTopPredictions[0];
        return {
          label: top.label,
          confidence: top.confidence,
          margin: gateNormalMargin,
          topK: gateTopPredictions,
          source: "tflite",
        };
      }
      return null;
    }
    const scores = runModelOnDecoded(tfliteModel, decoded.data, decoded.width, decoded.height);
    if (!scores) return null;

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


    // Only return "normal_skin" when gate is very confident AND disease model is not confident.
    if (
      gateNormalConf >= NORMAL_SKIN_THRESHOLD &&
      gateNormalMargin >= NORMAL_SKIN_MARGIN_THRESHOLD &&
      confidence < DISEASE_LOW_CONFIDENCE_THRESHOLD
    ) {
      return {
        label: "normal_skin",
        confidence: gateNormalConf,
        margin: gateNormalMargin,
        topK: gateTopPredictions,
        source: "tflite",
      };
    }

    console.log("[TFLite] Returning prediction:", label, "@", confidence);
    return { label, confidence, margin, topK: topPredictions, source: "tflite" };
  } catch (e) {
    console.error("[TFLite] analyzeSkinPhotoWithTflite threw:", e);
    return null;
  }
}
