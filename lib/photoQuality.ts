import * as FileSystem from 'expo-file-system';
import { toByteArray } from 'base64-js';
import jpeg from 'jpeg-js';

export type PhotoQualityAssessment = {
  summary: 'good' | 'warning';
  tips: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function assessDecodedJpeg(
  data: Uint8Array,
  width: number,
  height: number
): PhotoQualityAssessment {
  const sampleStep = clamp(Math.floor(Math.min(width, height) / 180), 2, 8);

  let luminanceSum = 0;
  let sampleCount = 0;
  let edgeSumCenter = 0;
  let edgeCountCenter = 0;
  let edgeSumBorder = 0;
  let edgeCountBorder = 0;
  const centerLeft = width * 0.25;
  const centerRight = width * 0.75;
  const centerTop = height * 0.25;
  const centerBottom = height * 0.75;
  const borderMargin = Math.min(width, height) * 0.15;

  // Blur estimate with Laplacian variance over sampled pixels.
  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;

  for (let y = sampleStep; y < height - sampleStep; y += sampleStep) {
    for (let x = sampleStep; x < width - sampleStep; x += sampleStep) {
      const idx = (y * width + x) * 4;
      const lum = luminance(data[idx], data[idx + 1], data[idx + 2]);
      luminanceSum += lum;
      sampleCount += 1;

      const leftIdx = (y * width + (x - sampleStep)) * 4;
      const rightIdx = (y * width + (x + sampleStep)) * 4;
      const upIdx = ((y - sampleStep) * width + x) * 4;
      const downIdx = ((y + sampleStep) * width + x) * 4;

      const leftLum = luminance(data[leftIdx], data[leftIdx + 1], data[leftIdx + 2]);
      const rightLum = luminance(data[rightIdx], data[rightIdx + 1], data[rightIdx + 2]);
      const upLum = luminance(data[upIdx], data[upIdx + 1], data[upIdx + 2]);
      const downLum = luminance(data[downIdx], data[downIdx + 1], data[downIdx + 2]);

      const lap = Math.abs(4 * lum - leftLum - rightLum - upLum - downLum);
      lapSum += lap;
      lapSqSum += lap * lap;
      lapCount += 1;

      const edgeStrength = Math.abs(rightLum - leftLum) + Math.abs(downLum - upLum);
      const inCenter = x > centerLeft && x < centerRight && y > centerTop && y < centerBottom;
      const inBorder =
        x < borderMargin || x > width - borderMargin || y < borderMargin || y > height - borderMargin;

      if (inCenter) {
        edgeSumCenter += edgeStrength;
        edgeCountCenter += 1;
      } else if (inBorder) {
        edgeSumBorder += edgeStrength;
        edgeCountBorder += 1;
      }
    }
  }

  const avgLum = luminanceSum / Math.max(sampleCount, 1);
  const lapMean = lapSum / Math.max(lapCount, 1);
  const lapVariance = lapSqSum / Math.max(lapCount, 1) - lapMean * lapMean;
  const centerDetail = edgeSumCenter / Math.max(edgeCountCenter, 1);
  const borderDetail = edgeSumBorder / Math.max(edgeCountBorder, 1);
  const tips: string[] = [];

  if (avgLum < 65) tips.push('Too dark. Add light or avoid shadows.');
  if (avgLum > 205) tips.push('Too bright. Reduce direct light or glare.');
  if (lapVariance < 650) tips.push('Too blurry. Hold steady and refocus.');
  if (centerDetail < borderDetail * 0.75) tips.push('Zoom in or move closer.');
  if (centerDetail > borderDetail * 2.4) tips.push('Zoom out or move slightly back.');

  if (!tips.length) {
    tips.push('Picture looks great.');
    return { summary: 'good', tips };
  }

  return { summary: 'warning', tips };
}

export function assessPhotoQualityFromBase64(base64: string): PhotoQualityAssessment {
  try {
    const jpgBytes = toByteArray(base64);
    const decoded = jpeg.decode(jpgBytes, { useTArray: true });
    if (!decoded?.data || !decoded.width || !decoded.height) {
      return { summary: 'warning', tips: ['Could not read image quality.'] };
    }

    return assessDecodedJpeg(decoded.data, decoded.width, decoded.height);
  } catch {
    return { summary: 'warning', tips: ['Could not evaluate quality.'] };
  }
}

export async function assessPhotoQuality(photoUri: string): Promise<PhotoQualityAssessment> {
  try {
    const base64 = await FileSystem.readAsStringAsync(photoUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return assessPhotoQualityFromBase64(base64);
  } catch {
    return { summary: 'warning', tips: ['Could not evaluate quality.'] };
  }
}
