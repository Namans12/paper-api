import type { Gray } from './image';

export interface Blob { cx: number; cy: number; area: number; w: number; h: number }

/** Otsu's threshold: pixels with value <= result are the dark class. */
export function otsu(g: Gray): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]]++;
  const total = g.data.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let wB = 0, sumB = 0, best = -1, bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  return bestT;
}

/**
 * 4-connected components of pixels with value <= threshold that look like a solid square:
 * not touching the image border, bbox aspect 0.5-2, fill ratio >= 0.6, and an area between
 * (0.008*maxDim)^2 and (0.15*maxDim)^2 where maxDim is the longer image side.
 */
export function findSolidSquares(g: Gray, threshold: number): Blob[] {
  const { width: W, height: H, data } = g;
  const maxDim = Math.max(W, H);
  const minArea = (0.008 * maxDim) ** 2, maxArea = (0.15 * maxDim) ** 2;
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const out: Blob[] = [];
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || data[start] > threshold) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let area = 0, sx = 0, sy = 0, minX = W, maxX = -1, minY = H, maxY = -1;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % W, y = (p - x) / W;
      area++; sx += x + 0.5; sy += y + 0.5;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && !seen[p - 1] && data[p - 1] <= threshold) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < W - 1 && !seen[p + 1] && data[p + 1] <= threshold) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && !seen[p - W] && data[p - W] <= threshold) { seen[p - W] = 1; stack[sp++] = p - W; }
      if (y < H - 1 && !seen[p + W] && data[p + W] <= threshold) { seen[p + W] = 1; stack[sp++] = p + W; }
    }
    if (minX === 0 || minY === 0 || maxX === W - 1 || maxY === H - 1) continue;
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const aspect = w / h;
    if (aspect < 0.5 || aspect > 2) continue;
    if (area / (w * h) < 0.6) continue;
    if (area < minArea || area > maxArea) continue;
    out.push({ cx: sx / area, cy: sy / area, area, w, h });
  }
  return out;
}
