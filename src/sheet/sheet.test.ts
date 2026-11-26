import jsQR from 'jsqr';
import { BOX_XS, boxRect, FIDUCIAL_SIZE, fiducialCenters, SAMPLE_INSET } from './layout';
import { decodePayload, encodePayload, qrMatrix, qrSymbolCorners } from './qr';
import { renderSheetRaster, type FixtureMark, type RGBA } from './raster';
import { defaultPhotoOptions, simulatePhoto } from './simulate';

const id = 'abcdefghik';
const rows = Array.from({ length: 6 }, (_, i) => ({
  binId: `B-${i}`,
  label: `Bin ${i}`,
  printedStatus: 'ready' as const,
  printedRev: 1,
}));
const sheet = { id, rows };
const PX = 4;

function interiorDarkFraction(img: RGBA, row: number, col: number): number {
  const b = boxRect(row, col);
  const x0 = Math.round((b.x + SAMPLE_INSET) * PX);
  const x1 = Math.round((b.x + b.w - SAMPLE_INSET) * PX);
  const y0 = Math.round((b.y + SAMPLE_INSET) * PX);
  const y1 = Math.round((b.y + b.h - SAMPLE_INSET) * PX);
  let dark = 0;
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      n++;
      if (img.data[(y * img.width + x) * 4] < 150) dark++;
    }
  return dark / n;
}

describe('qr payload', () => {
  it('qr payload round-trips and rejects foreign text', () => {
    expect(decodePayload(encodePayload(id))).toEqual({ sheetId: id });
    expect(decodePayload('https://x.y')).toBeNull();
    expect(decodePayload('PAPI2:abcdefghik')).toBeNull();
    expect(decodePayload('PAPI1:abcdefghi')).toBeNull();
  });

  it('symbol corners sit inside the box past the quiet zone', () => {
    const m = qrMatrix(encodePayload(id));
    const c = qrSymbolCorners(m.size);
    expect(c.tl[0]).toBeGreaterThan(148);
    expect(c.br[0]).toBeLessThan(192);
    expect(c.br[0] - c.tl[0]).toBeCloseTo((44 / (m.size + 8)) * m.size, 9);
  });
});

describe('raster sheet', () => {
  const img = renderSheetRaster(sheet, [
    { row: 0, col: 0, kind: 'x' },
    { row: 1, col: 1, kind: 'stray' },
  ]);

  it('raster sheet QR decodes with jsQR to the payload', () => {
    const r = jsQR(img.data, img.width, img.height);
    expect(r?.data).toBe(encodePayload(id));
  });

  it('raster sheet has dark fiducials at the four centres', () => {
    for (const [x, y] of fiducialCenters()) {
      expect(img.data[(Math.round(y * PX) * img.width + Math.round(x * PX)) * 4]).toBeLessThan(60);
    }
    expect(FIDUCIAL_SIZE).toBe(12);
  });

  it('x mark darkens its box interior and stray darkens it less', () => {
    const x = interiorDarkFraction(img, 0, 0);
    const stray = interiorDarkFraction(img, 1, 1);
    const empty = interiorDarkFraction(img, 2, 2);
    expect(x).toBeGreaterThan(0.1);
    expect(stray).toBeGreaterThan(0.03);
    expect(stray).toBeLessThan(0.1);
    expect(empty).toBeLessThan(0.01);
    expect(BOX_XS).toHaveLength(3);
  });

  it('payloadOverride replaces the QR text', () => {
    const o = renderSheetRaster(sheet, [] as FixtureMark[], 4, 'hello');
    expect(jsQR(o.data, o.width, o.height)?.data).toBe('hello');
  });
});

describe('simulatePhoto', () => {
  const page = renderSheetRaster(sheet, []);
  it('is deterministic for a seed and puts page TL at corners[0]', () => {
    const o = { ...defaultPhotoOptions(7), noise: 0, lightGradient: 0 };
    const a = simulatePhoto(page, defaultPhotoOptions(7));
    const b = simulatePhoto(page, defaultPhotoOptions(7));
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    const c = simulatePhoto(page, defaultPhotoOptions(8));
    expect(Buffer.from(a.data).equals(Buffer.from(c.data))).toBe(false);
    // page TL fiducial centre is at page (16,16)mm; page TL corner is at corners[0].
    const p = simulatePhoto(page, o);
    expect(p.width).toBe(1200);
    const [cx, cy] = o.corners[0];
    // just inside the corner is paper (250), just outside is background (90)
    const inside = p.data[((Math.round(cy) + 6) * p.width + Math.round(cx) + 6) * 4];
    const outside = p.data[((Math.round(cy) - 6) * p.width + Math.round(cx) - 6) * 4];
    expect(inside).toBeGreaterThan(200);
    expect(outside).toBeLessThan(120);
  });
});
