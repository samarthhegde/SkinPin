import * as FileSystem from "expo-file-system/legacy";
import { toByteArray } from "base64-js";
import jpeg from "jpeg-js";

export type ColorFeatures = {
  redScore: number;   // 0–1: proportion of pixels that look "angry red / inflamed"
  darkScore: number;  // 0–1: proportion of pixels that look "dark / pigmented" (melanoma concern)
  avgR: number;       // 0–255 average red channel
  avgG: number;
  avgB: number;
  rednessRatio: number; // R / (G + B + 1) — overall redness cast of the image
};

// Decode JPEG and sample every STEP pixels for speed
const SAMPLE_STEP = 4;

export async function analyzePhotoColors(photoUri: string): Promise<ColorFeatures | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(photoUri, {
      encoding: "base64" as any,
    });
    const jpgBytes = toByteArray(base64);
    const decoded = jpeg.decode(jpgBytes, { useTArray: true });
    if (!decoded?.data || !decoded.width || !decoded.height) return null;

    const { data, width, height } = decoded;
    const pixelCount = width * height;

    let sumR = 0, sumG = 0, sumB = 0;
    let angryRedCount = 0;   // inflamed / erythema
    let darkRedCount = 0;    // dark pigmented spots (melanoma concern)
    let sampledPixels = 0;

    for (let i = 0; i < pixelCount; i += SAMPLE_STEP) {
      const idx = i * 4;
      const R = data[idx];
      const G = data[idx + 1];
      const B = data[idx + 2];

      sumR += R;
      sumG += G;
      sumB += B;
      sampledPixels++;

      // "Angry red" — classic inflammation / rash signal:
      // Red dominates, green and blue are clearly lower, not just whitish skin
      if (
        R > 140 &&
        R > G + 35 &&
        R > B + 35 &&
        G < 160 &&
        B < 160
      ) {
        angryRedCount++;
      }

      // "Dark suspicious" — pigmented lesion (mole, melanoma):
      // Low overall brightness, slight warm cast, not just shadow
      const lum = 0.299 * R + 0.587 * G + 0.114 * B;
      if (lum < 80 && R >= G && R >= B && (R - B) > 5) {
        darkRedCount++;
      }
    }

    if (sampledPixels === 0) return null;

    const avgR = sumR / sampledPixels;
    const avgG = sumG / sampledPixels;
    const avgB = sumB / sampledPixels;

    return {
      redScore: angryRedCount / sampledPixels,
      darkScore: darkRedCount / sampledPixels,
      avgR,
      avgG,
      avgB,
      rednessRatio: avgR / (avgG + avgB + 1),
    };
  } catch {
    return null;
  }
}
