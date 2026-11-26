import jsQR from 'jsqr';
import { STATUSES, type Reading, type Status } from '../domain/types';
import { applyH, homography, type Pt } from '../geometry/homography';
import { boxRect, fiducialCenters, SAMPLE_INSET, type Rect } from '../sheet/layout';
import { decodePayload, encodePayload, qrMatrix, qrSymbolCorners } from '../sheet/qr';
import type { RGBA } from '../sheet/raster';
import { findSolidSquares, otsu, type Blob } from './fiducials';
import { downscale, sampleGray, toGray, type Gray } from './image';

export const MARK_THRESHOLD = 0.10, EMPTY_THRESHOLD = 0.03, INK_RATIO = 0.6;

export type ReadFailure = 'no-qr' | 'bad-payload' | 'no-alignment' | 'alignment-mismatch';
export interface BoxRead { status: Status; score: number }
export interface RowRead { row: number; boxes: BoxRead[]; reading: Reading }
export type ReadResult =
  | { ok: false; reason: ReadFailure; message: string }
  | { ok: true; sheetId: string; H: number[]; image: RGBA; rows: RowRead[] };

const fail = (reason: ReadFailure, message: string): ReadResult => ({ ok: false, reason, message });

const GRID = 20;
const RING_NEAR = 1.2, RING_FAR = 3.5, RING_PER_SIDE = 20;
const RING_DISTANCES = [RING_NEAR, 1.775, 2.35, 2.925, RING_FAR];

function pickFiducials(gray: Gray, predicted: Pt[]): Blob[] | null {
  const t = otsu(gray);
  const diag = Math.hypot(gray.width, gray.height);
  for (const threshold of [t, 0.75 * t]) {
    const cands = findSolidSquares(gray, threshold);
    if (cands.length < 4) continue;
    const chosen: Blob[] = [];
    for (const p of predicted) {
      let best: Blob | null = null, bestD = 0.25 * diag;
      for (const c of cands) {
        const d = Math.hypot(c.cx - p[0], c.cy - p[1]);
        if (d <= bestD && !chosen.includes(c)) { best = c; bestD = d; }
      }
      if (!best) break;
      chosen.push(best);
    }
    if (chosen.length < 4) continue;
    const areas = chosen.map((c) => c.area);
    if (Math.max(...areas) > 4 * Math.min(...areas)) continue;
    return chosen;
  }
  return null;
}

function scaleAt(H: number[], p: Pt): number {
  const a = applyH(H, p), bx = applyH(H, [p[0] + 1, p[1]]), by = applyH(H, [p[0], p[1] + 1]);
  const ux = bx[0] - a[0], uy = bx[1] - a[1], vx = by[0] - a[0], vy = by[1] - a[1];
  return Math.sqrt(Math.abs(ux * vy - uy * vx));
}

function boxScore(gray: Gray, H: number[], b: Rect): number {
  const ring: number[] = [];
  for (let i = 0; i < RING_PER_SIDE; i++) {
    const f = (i + 0.5) / RING_PER_SIDE;
    const d = RING_DISTANCES[i % RING_DISTANCES.length];
    const along = f * b.w;
    const pts: Pt[] = [
      [b.x + along, b.y - d], [b.x + along, b.y + b.h + d],
      [b.x - d, b.y + along], [b.x + b.w + d, b.y + along],
    ];
    for (const p of pts) { const q = applyH(H, p); ring.push(sampleGray(gray, q[0], q[1])); }
  }
  ring.sort((a, c) => a - c);
  const white = ring[Math.floor(0.8 * (ring.length - 1))];
  const cutoff = INK_RATIO * white;
  const x0 = b.x + SAMPLE_INSET, y0 = b.y + SAMPLE_INSET, span = b.w - 2 * SAMPLE_INSET;
  let dark = 0;
  for (let j = 0; j < GRID; j++)
    for (let i = 0; i < GRID; i++) {
      const q = applyH(H, [x0 + ((i + 0.5) / GRID) * span, y0 + ((j + 0.5) / GRID) * span]);
      if (sampleGray(gray, q[0], q[1]) < cutoff) dark++;
    }
  return dark / (GRID * GRID);
}

function classify(boxes: BoxRead[]): Reading {
  const cls = boxes.map((b) => (b.score >= MARK_THRESHOLD ? 'mark' : b.score <= EMPTY_THRESHOLD ? 'empty' : 'uncertain'));
  if (cls.includes('uncertain')) return { kind: 'uncertain' };
  const marked = boxes.filter((_, i) => cls[i] === 'mark').map((b) => b.status);
  if (marked.length === 0) return { kind: 'blank' };
  if (marked.length === 1) return { kind: 'mark', status: marked[0] };
  return { kind: 'double', statuses: marked };
}

export function readSheet(img: RGBA, opts: { maxDim?: number } = {}): ReadResult {
  const maxDim = opts.maxDim ?? 1600;
  // jsQR can miss a noisy photo at full size; a smoothing downscale gives it a second chance.
  let image = downscale(img, maxDim);
  let qr = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
  if (!qr) {
    const smaller = downscale(img, Math.round(maxDim * 0.6));
    if (smaller !== image) {
      const second = jsQR(smaller.data, smaller.width, smaller.height, { inversionAttempts: 'attemptBoth' });
      if (second) { image = smaller; qr = second; }
    }
  }
  const gray = toGray(image);
  if (!qr) return fail('no-qr', 'No QR code found in the photo.');
  const payload = decodePayload(qr.data);
  if (!payload) return fail('bad-payload', 'The QR code is not a Paper API stocktake sheet (unsupported layout).');

  const size = qrMatrix(encodePayload(payload.sheetId)).size;
  const sym = qrSymbolCorners(size);
  const symPage: Pt[] = [sym.tl, sym.tr, sym.br, sym.bl];
  const loc = qr.location;
  const symImg: Pt[] = [
    [loc.topLeftCorner.x, loc.topLeftCorner.y], [loc.topRightCorner.x, loc.topRightCorner.y],
    [loc.bottomRightCorner.x, loc.bottomRightCorner.y], [loc.bottomLeftCorner.x, loc.bottomLeftCorner.y],
  ];

  const noAlign = () => fail('no-alignment', 'Could not find all four corner squares. Retake the photo with the whole sheet in view.');
  let H: number[];
  let blobs: Blob[] | null;
  try {
    const Hq = homography(symPage, symImg);
    const predicted = fiducialCenters().map((c) => applyH(Hq, c));
    blobs = pickFiducials(gray, predicted);
    if (!blobs) return noAlign();
    H = homography(fiducialCenters(), blobs.map((b) => [b.cx, b.cy] as Pt));
  } catch {
    return noAlign();
  }

  const mid: Pt = [(sym.tl[0] + sym.br[0]) / 2, (sym.tl[1] + sym.br[1]) / 2];
  const pxPerMm = scaleAt(H, mid);
  let errPx = 0;
  symPage.forEach((p, i) => {
    const q = applyH(H, p);
    errPx += Math.hypot(q[0] - symImg[i][0], q[1] - symImg[i][1]);
  });
  errPx /= 4;
  if (!(pxPerMm > 0) || errPx / pxPerMm > 4)
    return fail('alignment-mismatch', 'The corner squares and the QR code disagree about where the sheet is. Retake the photo flat and fully in view.');

  const rows: RowRead[] = [];
  for (let r = 0; r < 6; r++) {
    const boxes: BoxRead[] = STATUSES.map((status, c) => ({ status, score: boxScore(gray, H, boxRect(r, c)) }));
    rows.push({ row: r, boxes, reading: classify(boxes) });
  }
  return { ok: true, sheetId: payload.sheetId, H, image, rows };
}

export function renderCrop(img: RGBA, H: number[], rect: Rect, pxPerMm = 6): RGBA {
  const width = Math.round(rect.w * pxPerMm), height = Math.round(rect.h * pxPerMm);
  const out = new Uint8ClampedArray(width * height * 4);
  const W = img.width, Ht = img.height, d = img.data;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const q = applyH(H, [rect.x + (x + 0.5) / pxPerMm, rect.y + (y + 0.5) / pxPerMm]);
      const fx = Math.min(Math.max(q[0] - 0.5, 0), W - 1), fy = Math.min(Math.max(q[1] - 0.5, 0), Ht - 1);
      const ix = Math.min(Math.floor(fx), Math.max(0, W - 2)), iy = Math.min(Math.floor(fy), Math.max(0, Ht - 2));
      const ix1 = Math.min(ix + 1, W - 1), iy1 = Math.min(iy + 1, Ht - 1);
      const tx = fx - ix, ty = fy - iy;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++)
        out[o + c] =
          d[(iy * W + ix) * 4 + c] * (1 - tx) * (1 - ty) + d[(iy * W + ix1) * 4 + c] * tx * (1 - ty) +
          d[(iy1 * W + ix) * 4 + c] * (1 - tx) * ty + d[(iy1 * W + ix1) * 4 + c] * tx * ty;
      out[o + 3] = 255;
    }
  return { width, height, data: out };
}
