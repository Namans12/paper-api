import { defaultPhotoOptions, simulatePhoto, type PhotoOptions } from '../sheet/simulate';
import { renderSheetRaster, type FixtureMark, type RGBA } from '../sheet/raster';
import { rowRect } from '../sheet/layout';
import type { Reading } from '../domain/types';
import type { Pt } from '../geometry/homography';
import { readSheet, renderCrop } from './read';

const id = 'abcdefghik';
const rows = Array.from({ length: 6 }, (_, i) => ({
  binId: `B-${i}`,
  label: `Bin ${i}`,
  printedStatus: 'ready' as const,
  printedRev: 1,
}));
const sheet = { id, rows };

/** Permute page corners so the page lands rotated `rot` degrees clockwise. */
function rotatedCorners(w: number, h: number, rot: 0 | 90 | 180 | 270, jitter: Pt[] = []): PhotoOptions['corners'] {
  const long = Math.max(w, h) * 0.9;
  const short = long * (210 / 297);
  const pw = rot === 0 || rot === 180 ? short : long;
  const ph = rot === 0 || rot === 180 ? long : short;
  const x0 = (w - pw) / 2, y0 = (h - ph) / 2;
  const tl: Pt = [x0, y0], tr: Pt = [x0 + pw, y0], bl: Pt = [x0, y0 + ph], br: Pt = [x0 + pw, y0 + ph];
  const perm = { 0: [tl, tr, bl, br], 90: [tr, br, tl, bl], 180: [br, bl, tr, tl], 270: [bl, tl, br, tr] }[rot];
  return perm.map((p, i) => [p[0] + (jitter[i]?.[0] ?? 0), p[1] + (jitter[i]?.[1] ?? 0)] as Pt) as PhotoOptions['corners'];
}

const fixtureMarks: FixtureMark[] = [
  { row: 1, col: 2, kind: 'x' },
  { row: 3, col: 1, kind: 'x' },
  { row: 4, col: 2, kind: 'x' },
];
const blank: Reading = { kind: 'blank' };
const expected: Reading[] = [
  blank,
  { kind: 'mark', status: 'unavailable' },
  blank,
  { kind: 'mark', status: 'needs-inspection' },
  { kind: 'mark', status: 'unavailable' },
  blank,
];

function readings(r: ReturnType<typeof readSheet>): Reading[] {
  if (!r.ok) throw new Error(`read failed: ${r.reason}`);
  return r.rows.map((x) => x.reading);
}

describe('readSheet', () => {
  it('reads the bin 4 fixture', () => {
    const photo = simulatePhoto(renderSheetRaster(sheet, fixtureMarks), defaultPhotoOptions(7));
    const r = readSheet(photo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sheetId).toBe(id);
    expect(r.rows.map((x) => x.reading)).toEqual(expected);
    expect(r.rows.every((x) => x.boxes.length === 3)).toBe(true);
  });

  it('flags a double mark', () => {
    const marks: FixtureMark[] = [{ row: 2, col: 0, kind: 'x' }, { row: 2, col: 2, kind: 'x' }];
    const r = readSheet(simulatePhoto(renderSheetRaster(sheet, marks), defaultPhotoOptions(3)));
    expect(readings(r)[2]).toEqual({ kind: 'double', statuses: ['ready', 'unavailable'] });
  });

  it('flags a stray mark', () => {
    const r = readSheet(simulatePhoto(renderSheetRaster(sheet, [{ row: 0, col: 1, kind: 'stray' }]), defaultPhotoOptions(5)));
    expect(readings(r)[0]).toEqual({ kind: 'uncertain' });
  });

  it('reads a sheet rotated 90 and 180 degrees', () => {
    const page = renderSheetRaster(sheet, fixtureMarks);
    for (const rot of [90, 180, 270] as const) {
      const [w, h] = rot === 180 ? [1200, 1600] : [1600, 1200];
      const opts = { ...defaultPhotoOptions(11), width: w, height: h, corners: rotatedCorners(w, h, rot) };
      expect(readings(readSheet(simulatePhoto(page, opts)))).toEqual(expected);
    }
  });

  it('rejects when one fiducial is covered', () => {
    const page = renderSheetRaster(sheet, fixtureMarks);
    const px = 4;
    const cx = 194 * px, cy = 281 * px, half = 7.5 * px;
    for (let y = Math.round(cy - half); y < Math.round(cy + half); y++)
      for (let x = Math.round(cx - half); x < Math.round(cx + half); x++)
        for (let c = 0; c < 3; c++) page.data[(y * page.width + x) * 4 + c] = 250;
    const r = readSheet(simulatePhoto(page, defaultPhotoOptions(2)));
    expect(r).toMatchObject({ ok: false, reason: 'no-alignment' });
  });

  it('rejects a foreign QR payload', () => {
    const page = renderSheetRaster(sheet, [], 4, 'https://example.org');
    const r = readSheet(simulatePhoto(page, defaultPhotoOptions(4)));
    expect(r).toMatchObject({ ok: false, reason: 'bad-payload' });
  });

  it('returns no-qr for a blank image', () => {
    const img: RGBA = { width: 800, height: 600, data: new Uint8ClampedArray(800 * 600 * 4).fill(200) };
    expect(readSheet(img)).toMatchObject({ ok: false, reason: 'no-qr' });
  });

  test('reads a 4032x3024 photo within 3 seconds', () => {
    const w = 4032, h = 3024;
    const opts = { ...defaultPhotoOptions(9), width: w, height: h, corners: rotatedCorners(w, h, 90) };
    const photo = simulatePhoto(renderSheetRaster(sheet, fixtureMarks), opts);
    const t0 = performance.now();
    const r = readSheet(photo);
    const ms = performance.now() - t0;
    expect(r.ok).toBe(true);
    expect(ms).toBeLessThan(3000);
  }, 60_000);

  it('renderCrop returns a rowRect-sized image', () => {
    const r = readSheet(simulatePhoto(renderSheetRaster(sheet, fixtureMarks), defaultPhotoOptions(7)));
    if (!r.ok) throw new Error(r.reason);
    const rect = rowRect(1);
    const crop = renderCrop(r.image, r.H, rect);
    expect(crop.width).toBe(Math.round(182 * 6));
    expect(crop.height).toBe(Math.round(rect.h * 6));
    expect(crop.data.length).toBe(crop.width * crop.height * 4);
  });
});
