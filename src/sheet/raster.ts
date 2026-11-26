import type { Sheet } from '../domain/types';
import { STATUSES } from '../domain/types';
import {
  BOX_XS, boxRect, FIDUCIAL_ORIGINS, FIDUCIAL_SIZE, PAGE, QR_BOX, ROW_COUNT, ROW_HEIGHT, ROW_TOP,
  type Rect,
} from './layout';
import { encodePayload, qrMatrix } from './qr';

export interface RGBA { width: number; height: number; data: Uint8ClampedArray }
export type MarkKind = 'x' | 'stray';
export interface FixtureMark { row: number; col: number; kind: MarkKind }

const PAPER = 250, INK = 25, TEXT = 90, PEN = 35;

export function renderSheetRaster(
  sheet: Pick<Sheet, 'id' | 'rows'>,
  marks: FixtureMark[],
  pxPerMm = 4,
  payloadOverride?: string,
): RGBA {
  const width = Math.round(PAGE.w * pxPerMm);
  const height = Math.round(PAGE.h * pxPerMm);
  const gray = new Uint8ClampedArray(width * height).fill(PAPER);

  const fillRect = (r: Rect, v: number) => {
    const x0 = Math.max(0, Math.round(r.x * pxPerMm)), x1 = Math.min(width, Math.round((r.x + r.w) * pxPerMm));
    const y0 = Math.max(0, Math.round(r.y * pxPerMm)), y1 = Math.min(height, Math.round((r.y + r.h) * pxPerMm));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) gray[y * width + x] = v;
  };
  const disc = (cx: number, cy: number, radius: number, v: number) => {
    const x0 = Math.floor((cx - radius) * pxPerMm), x1 = Math.ceil((cx + radius) * pxPerMm);
    const y0 = Math.floor((cy - radius) * pxPerMm), y1 = Math.ceil((cy + radius) * pxPerMm);
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
        const dx = (x + 0.5) / pxPerMm - cx, dy = (y + 0.5) / pxPerMm - cy;
        if (dx * dx + dy * dy <= radius * radius) gray[y * width + x] = v;
      }
  };
  const stroke = (a: [number, number], b: [number, number], w: number, v: number) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / 0.1));
    for (let i = 0; i <= n; i++) disc(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, w / 2, v);
  };

  // Fiducials
  for (const [x, y] of FIDUCIAL_ORIGINS) fillRect({ x, y, w: FIDUCIAL_SIZE, h: FIDUCIAL_SIZE }, INK);

  // QR, per pixel so module edges follow px = mm * pxPerMm exactly
  const qr = qrMatrix(payloadOverride ?? encodePayload(sheet.id));
  const mod = QR_BOX.w / (qr.size + 8);
  const qx0 = Math.round(QR_BOX.x * pxPerMm), qx1 = Math.round((QR_BOX.x + QR_BOX.w) * pxPerMm);
  const qy0 = Math.round(QR_BOX.y * pxPerMm), qy1 = Math.round((QR_BOX.y + QR_BOX.h) * pxPerMm);
  for (let y = qy0; y < qy1; y++)
    for (let x = qx0; x < qx1; x++) {
      const c = Math.floor(((x + 0.5) / pxPerMm - QR_BOX.x) / mod) - 4;
      const r = Math.floor(((y + 0.5) / pxPerMm - QR_BOX.y) / mod) - 4;
      if (r >= 0 && c >= 0 && r < qr.size && c < qr.size && qr.get(r, c)) gray[y * width + x] = INK;
    }

  // Text stand-ins
  const bar = (x: number, cy: number, w: number) => fillRect({ x, y: cy - 1.5, w, h: 3 }, TEXT);
  BOX_XS.forEach((bx, i) => bar(bx, ROW_TOP - 8, 6 + STATUSES[i].length));
  for (let r = 0; r < Math.min(sheet.rows.length, ROW_COUNT); r++) {
    const cy = ROW_TOP + r * ROW_HEIGHT + ROW_HEIGHT / 2;
    const row = sheet.rows[r];
    bar(20, cy, Math.min(36, 4 + row.label.length * 1.5));
    bar(60, cy, Math.min(40, 4 + row.printedStatus.length * 1.5));
  }

  // Checkbox borders (0.6 mm, inside the box rect)
  for (let r = 0; r < ROW_COUNT; r++)
    for (let c = 0; c < BOX_XS.length; c++) {
      const b = boxRect(r, c);
      const t = 0.6;
      fillRect({ x: b.x, y: b.y, w: b.w, h: t }, INK);
      fillRect({ x: b.x, y: b.y + b.h - t, w: b.w, h: t }, INK);
      fillRect({ x: b.x, y: b.y, w: t, h: b.h }, INK);
      fillRect({ x: b.x + b.w - t, y: b.y, w: t, h: b.h }, INK);
    }

  // Pen marks
  for (const m of marks) {
    const b = boxRect(m.row, m.col);
    if (m.kind === 'x') {
      const i = 1.5;
      stroke([b.x + i, b.y + i], [b.x + b.w - i, b.y + b.h - i], 0.9, PEN);
      stroke([b.x + b.w - i, b.y + i], [b.x + i, b.y + b.h - i], 0.9, PEN);
    } else {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      stroke([cx - 1.25, cy], [cx + 1.25, cy], 0.8, PEN);
    }
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < gray.length; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = gray[i];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}
