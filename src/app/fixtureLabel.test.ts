import { withLabelStrip, LABEL_STRIP_PX } from './fixtureLabel';
import { renderSheetRaster, type FixtureMark } from '../sheet/raster';
import { defaultPhotoOptions, simulatePhoto } from '../sheet/simulate';
import { readSheet } from '../reader/read';

const sheet = {
  id: 'abcdefghik',
  rows: Array.from({ length: 6 }, (_, i) => ({ binId: `B-${i}`, label: `Bin ${i}`, printedStatus: 'ready' as const, printedRev: 1 })),
};
const marks: FixtureMark[] = [
  { row: 1, col: 2, kind: 'x' }, { row: 3, col: 1, kind: 'x' }, { row: 4, col: 2, kind: 'x' },
];

describe('withLabelStrip', () => {
  const img = { width: 5, height: 3, data: Uint8ClampedArray.from({ length: 60 }, (_, i) => (i * 7) % 256) };
  const out = withLabelStrip(img);
  it('adds a solid gray strip on top', () => {
    expect(out.height).toBe(3 + LABEL_STRIP_PX);
    expect(out.width).toBe(5);
    for (let i = 0; i < 5 * LABEL_STRIP_PX * 4; i += 4) {
      expect([out.data[i], out.data[i + 1], out.data[i + 2], out.data[i + 3]]).toEqual([90, 90, 90, 255]);
    }
  });
  it('keeps the original rows unchanged below', () => {
    expect(Array.from(out.data.slice(5 * LABEL_STRIP_PX * 4))).toEqual(Array.from(img.data));
  });
  it('still reads correctly for 20 seeds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const photo = withLabelStrip(simulatePhoto(renderSheetRaster(sheet, marks, 4), defaultPhotoOptions(seed)));
      const r = readSheet(photo, { maxDim: 2000 });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.rows.map((x) => x.reading)).toEqual([
        { kind: 'blank' }, { kind: 'mark', status: 'unavailable' }, { kind: 'blank' },
        { kind: 'mark', status: 'needs-inspection' }, { kind: 'mark', status: 'unavailable' }, { kind: 'blank' },
      ]);
    }
  });
});
