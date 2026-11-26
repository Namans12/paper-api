import QRCode from 'qrcode';
import type { Pt } from '../geometry/homography';
import { QR_BOX } from './layout';

export function encodePayload(sheetId: string): string {
  return `PAPI1:${sheetId}`;
}

export function decodePayload(text: string): { sheetId: string } | null {
  const m = /^PAPI1:([a-z2-9]{10})$/.exec(text);
  return m ? { sheetId: m[1] } : null;
}

export interface QrMatrix { size: number; get(row: number, col: number): boolean }

export function qrMatrix(text: string): QrMatrix {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  return { size: modules.size, get: (row, col) => Boolean(modules.get(row, col)) };
}

/** Corners of the QR symbol proper (quiet zone excluded), in page mm. */
export function qrSymbolCorners(size: number): { tl: Pt; tr: Pt; br: Pt; bl: Pt } {
  const m = QR_BOX.w / (size + 8);
  const x0 = QR_BOX.x + 4 * m;
  const y0 = QR_BOX.y + 4 * m;
  const x1 = QR_BOX.x + (4 + size) * m;
  const y1 = QR_BOX.y + (4 + size) * m;
  return { tl: [x0, y0], tr: [x1, y0], br: [x1, y1], bl: [x0, y1] };
}
