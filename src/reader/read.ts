import jsQR from 'jsqr';
import { STATUSES, type Reading, type Status } from '../domain/types';
import { affineFit, applyH, homography, type Pt } from '../geometry/homography';
import { boxRect, fiducialCenters, SAMPLE_INSET, type Rect } from '../sheet/layout';
import { decodePayload, encodePayload, qrMatrix, qrSymbolCorners } from '../sheet/qr';
import type { RGBA } from '../sheet/raster';
import { findSolidSquares, otsu } from './fiducials';
import { downscale, sampleGray, toGray, type Gray } from './image';

export const MARK_THRESHOLD = 0.10, EMPTY_THRESHOLD = 0.03, INK_RATIO = 0.6;
/** Minimum fraction of box-border probe points that must be found for the registration to be trusted. */
export const REGISTRATION_MIN = 0.85;
/** A fiducial candidate must lie within this many mm of its QR-predicted position. */
export const FIDUCIAL_GATE_MM = 80;

export type ReadFailure = 'no-qr' | 'bad-payload' | 'no-alignment' | 'alignment-mismatch';
export interface BoxRead { status: Status; score: number; registered?: boolean }
export interface RowRead { row: number; boxes: BoxRead[]; reading: Reading }
export type ReadResult =
  | { ok: false; reason: ReadFailure; message: string }
  | { ok: true; sheetId: string; H: number[]; image: RGBA; rows: RowRead[] };

const fail = (reason: ReadFailure, message: string): ReadResult => ({ ok: false, reason, message });

const GRID = 20;
const RING_NEAR = 1.2, RING_FAR = 3.5, RING_PER_SIDE = 20;
const RING_DISTANCES = [RING_NEAR, 1.775, 2.35, 2.925, RING_FAR];

function scaleAt(H: number[], p: Pt): number {
  const a = applyH(H, p), bx = applyH(H, [p[0] + 1, p[1]]), by = applyH(H, [p[0], p[1] + 1]);
  const ux = bx[0] - a[0], uy = bx[1] - a[1], vx = by[0] - a[0], vy = by[1] - a[1];
  return Math.sqrt(Math.abs(ux * vy - uy * vx));
}

function ringWhite(gray: Gray, H: number[], b: Rect): number {
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
  return ring[Math.floor(0.8 * (ring.length - 1))];
}

function boxScore(gray: Gray, H: number[], b: Rect): number {
  const white = ringWhite(gray, H, b);
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

const BORDER_CENTRE = 0.3, BORDER_SEARCH = 1.0;

/** A box counts as registered when >= BOX_HITS_MIN of its 12 border probes are found and every side has >= SIDE_HITS_MIN of 3. */
export const BOX_HITS_MIN = 11, SIDE_HITS_MIN = 2;
/** More unregistered boxes than this and the whole page is rejected as misaligned. */
export const MAX_UNREGISTERED_BOXES = 3;

/** Border probes of one box: 3 points on each of its 4 sides, found when the darkest pixel within +-1 mm is ink. */
export function boxBorderHits(gray: Gray, H: number[], b: Rect): { hits: number; sides: number[] } {
  const cutoff = INK_RATIO * ringWhite(gray, H, b);
  const sides = [0, 0, 0, 0];
  for (const f of [0.25, 0.5, 0.75]) {
    const a = f * b.w;
    // [point on the border line, unit direction perpendicular to the side]
    const probes: [Pt, Pt][] = [
      [[b.x + a, b.y + BORDER_CENTRE], [0, 1]], [[b.x + a, b.y + b.h - BORDER_CENTRE], [0, 1]],
      [[b.x + BORDER_CENTRE, b.y + a], [1, 0]], [[b.x + b.w - BORDER_CENTRE, b.y + a], [1, 0]],
    ];
    probes.forEach(([p, n], side) => {
      let darkest = 255;
      for (let k = -10; k <= 10; k++) {
        const t = (k / 10) * BORDER_SEARCH;
        const q = applyH(H, [p[0] + n[0] * t, p[1] + n[1] * t]);
        darkest = Math.min(darkest, sampleGray(gray, q[0], q[1]));
      }
      if (darkest < cutoff) sides[side]++;
    });
  }
  return { hits: sides[0] + sides[1] + sides[2] + sides[3], sides };
}

export function boxRegistered(gray: Gray, H: number[], b: Rect): boolean {
  const { hits, sides } = boxBorderHits(gray, H, b);
  return hits >= BOX_HITS_MIN && sides.every((n) => n >= SIDE_HITS_MIN);
}

/** Fraction of checkbox-border probe points (18 boxes x 4 sides x 3) that are found. */
export function registrationScore(gray: Gray, H: number[]): number {
  let found = 0;
  for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) found += boxBorderHits(gray, H, boxRect(r, c)).hits;
  return found / (18 * 12);
}

const PER_CORNER = 3;
type Alignment = { H: number[] } | { reason: 'no-alignment' | 'alignment-mismatch' };

/**
 * Find the page homography. Each fiducial may be any solid square within FIDUCIAL_GATE_MM of its predicted
 * position. Hp is a least-squares AFFINE fit to the 4 QR corners: the QR homography extrapolated ~250 mm off the
 * ~36 mm symbol drifts by tens of mm under perspective, the affine does not. Hp is used only for these gates;
 * every later check (QR agreement, registration, area ratio) is unchanged.
 * Every plausible combination of candidates is then verified against the QR corners and the checkbox borders of
 * the whole page, and the best-registered one wins.
 */
function align(gray: Gray, Hp: number[], symPage: Pt[], symImg: Pt[]): Alignment {
  const centres = fiducialCenters();
  const predicted = centres.map((c) => applyH(Hp, c));
  const gates = centres.map((c) => FIDUCIAL_GATE_MM * scaleAt(Hp, c));
  const t = otsu(gray);
  let reason: 'no-alignment' | 'alignment-mismatch' = 'no-alignment';
  for (const threshold of [t, 0.75 * t]) {
    const cands = findSolidSquares(gray, threshold);
    const lists = predicted.map((p, k) =>
      cands
        .map((c) => ({ c, d: Math.hypot(c.cx - p[0], c.cy - p[1]) }))
        .filter((e) => e.d <= gates[k])
        .sort((x, y) => x.d - y.d)
        .slice(0, PER_CORNER)
        .map((e) => e.c));
    if (lists.some((l) => l.length === 0)) continue;
    let best: { H: number[]; score: number } | null = null;
    for (const a of lists[0]) for (const b of lists[1]) for (const c of lists[2]) for (const d of lists[3]) {
      const chosen = [a, b, c, d];
      if (new Set(chosen).size < 4) continue;
      const areas = chosen.map((x) => x.area);
      if (Math.max(...areas) > 4 * Math.min(...areas)) continue;
      let H: number[];
      try { H = homography(centres, chosen.map((x) => [x.cx, x.cy] as Pt)); } catch { continue; }
      reason = 'alignment-mismatch';
      if (!qrAgrees(H, symPage, symImg)) continue;
      const score = registrationScore(gray, H);
      if (score >= REGISTRATION_MIN && (!best || score > best.score)) best = { H, score };
    }
    if (best) return { H: best.H };
  }
  return { reason };
}

function qrAgrees(H: number[], symPage: Pt[], symImg: Pt[]): boolean {
  const mid: Pt = [(symPage[0][0] + symPage[2][0]) / 2, (symPage[0][1] + symPage[2][1]) / 2];
  const pxPerMm = scaleAt(H, mid);
  let errPx = 0;
  symPage.forEach((p, i) => {
    const q = applyH(H, p);
    errPx += Math.hypot(q[0] - symImg[i][0], q[1] - symImg[i][1]);
  });
  return pxPerMm > 0 && errPx / 4 / pxPerMm <= 4;
}

function classify(boxes: BoxRead[]): Reading {
  const cls = boxes.map((b) => (b.registered === false ? 'uncertain' : b.score >= MARK_THRESHOLD ? 'mark' : b.score <= EMPTY_THRESHOLD ? 'empty' : 'uncertain'));
  if (cls.includes('uncertain')) return { kind: 'uncertain' };
  const marked = boxes.filter((_, i) => cls[i] === 'mark').map((b) => b.status);
  if (marked.length === 0) return { kind: 'blank' };
  if (marked.length === 1) return { kind: 'mark', status: marked[0] };
  return { kind: 'double', statuses: marked };
}

export function readSheet(img: RGBA, opts: { maxDim?: number } = {}): ReadResult {
  const maxDim = opts.maxDim ?? 1600;
  // The retry exists because jsQR can miss a noisy full-size photo that a smoothing downscale reads fine.
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

  let Hp: number[];
  try { homography(symPage, symImg); Hp = affineFit(symPage, symImg); } catch {
    return fail('no-alignment', 'Could not locate the sheet from the QR code. Retake the photo with the whole sheet in view.');
  }
  const aligned = align(gray, Hp, symPage, symImg);
  if ('reason' in aligned)
    return aligned.reason === 'no-alignment'
      ? fail('no-alignment', 'Could not find all four corner squares. Retake the photo with the whole sheet in view.')
      : fail('alignment-mismatch', 'The corner squares, QR code and checkboxes do not agree about where the sheet is. Retake the photo flat and fully in view.');
  const H = aligned.H;

  let unregistered = 0;
  const rows: RowRead[] = [];
  for (let r = 0; r < 6; r++) {
    const boxes: BoxRead[] = STATUSES.map((status, c) => {
      const rect = boxRect(r, c);
      return { status, score: boxScore(gray, H, rect), registered: boxRegistered(gray, H, rect) };
    });
    unregistered += boxes.filter((b) => !b.registered).length;
    rows.push({ row: r, boxes, reading: classify(boxes) });
  }
  if (unregistered > MAX_UNREGISTERED_BOXES)
    return fail('alignment-mismatch', 'Too many checkboxes do not line up with the sheet layout. Retake the photo flat and fully in view.');
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
