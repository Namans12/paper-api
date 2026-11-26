import fc from 'fast-check';
import type { Reading, Status } from '../domain/types';
import { STATUSES } from '../domain/types';
import type { Pt } from '../geometry/homography';
import { renderSheetRaster, type FixtureMark } from '../sheet/raster';
import { simulatePhoto, type PhotoOptions } from '../sheet/simulate';
import { readSheet } from './read';

const id = 'abcdefghik';
const rows = Array.from({ length: 6 }, (_, i) => ({
  binId: `B-${i}`, label: `Bin ${i}`, printedStatus: 'ready' as const, printedRev: 1,
}));
const sheet = { id, rows };

type Truth = { t: 'blank' } | { t: 'x'; cols: number[] } | { t: 'stray'; col: number };

function rotatedCorners(w: number, h: number, rot: 0 | 90 | 180 | 270, jitter: Pt[]): PhotoOptions['corners'] {
  const long = Math.max(w, h) * 0.9;
  const short = long * (210 / 297);
  const upright = rot === 0 || rot === 180;
  const pw = upright ? short : long, ph = upright ? long : short;
  const x0 = (w - pw) / 2, y0 = (h - ph) / 2;
  const tl: Pt = [x0, y0], tr: Pt = [x0 + pw, y0], bl: Pt = [x0, y0 + ph], br: Pt = [x0 + pw, y0 + ph];
  const perm = { 0: [tl, tr, bl, br], 90: [tr, br, tl, bl], 180: [br, bl, tr, tl], 270: [bl, tl, br, tr] }[rot];
  return perm.map((p, i) => [p[0] + jitter[i][0], p[1] + jitter[i][1]] as Pt) as PhotoOptions['corners'];
}

const truthArb: fc.Arbitrary<Truth> = fc.oneof(
  fc.constant<Truth>({ t: 'blank' }),
  fc.integer({ min: 0, max: 2 }).map<Truth>((c) => ({ t: 'x', cols: [c] })),
  fc.subarray([0, 1, 2], { minLength: 2, maxLength: 2 }).map<Truth>((cols) => ({ t: 'x', cols })),
  fc.integer({ min: 0, max: 2 }).map<Truth>((col) => ({ t: 'stray', col })),
);
const unit = fc.double({ min: -1, max: 1, noNaN: true });

let total = 0, okCount = 0;
afterAll(() => {
  expect(okCount / total).toBeGreaterThanOrEqual(0.9);
});

describe('readSheet properties', () => {
  it('never reports a wrong clean status, whatever the photo conditions', () => {
    fc.assert(
      fc.property(
        fc.array(truthArb, { minLength: 6, maxLength: 6 }),
        fc.constantFrom<0 | 90 | 180 | 270>(0, 90, 180, 270),
        fc.array(fc.tuple(unit, unit), { minLength: 4, maxLength: 4 }),
        fc.double({ min: 0, max: 0.35, noNaN: true }),
        fc.double({ min: 0, max: 14, noNaN: true }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (truths, rot, jit, lightGradient, noise, seed) => {
          const marks: FixtureMark[] = [];
          truths.forEach((t, row) => {
            if (t.t === 'x') t.cols.forEach((col) => marks.push({ row, col, kind: 'x' }));
            else if (t.t === 'stray') marks.push({ row, col: t.col, kind: 'stray' });
          });
          const [w, h] = rot === 0 || rot === 180 ? [1200, 1600] : [1600, 1200];
          // Up to 8% of the frame, but keep the page fully inside it (page is 90% of the long side, centred).
          const mx = (w - (rot === 0 || rot === 180 ? h * 0.9 * (210 / 297) : w * 0.9)) / 2;
          const my = (h - (rot === 0 || rot === 180 ? h * 0.9 : w * 0.9 * (210 / 297))) / 2;
          const jitter = jit.map(([a, b]) => [a * Math.min(0.08 * w, mx - 1), b * Math.min(0.08 * h, my - 1)] as Pt);
          const photo = simulatePhoto(renderSheetRaster(sheet, marks), {
            width: w, height: h, corners: rotatedCorners(w, h, rot, jitter),
            lightGradient, noise, background: 90, seed,
          });
          const r = readSheet(photo);
          total++;
          if (!r.ok) return;
          okCount++;
          r.rows.forEach((row, i) => {
            const truth = truths[i];
            const reading: Reading = row.reading;
            if (reading.kind === 'mark') {
              const s: Status = reading.status;
              expect(truth.t === 'x' && truth.cols.some((c) => STATUSES[c] === s)).toBe(true);
              expect(truth.t === 'x' && truth.cols.length === 1).toBe(true);
            }
            if (truth.t === 'x') expect(reading.kind).not.toBe('blank');
            if (reading.kind === 'double') expect(truth.t === 'x' && truth.cols.length === 2).toBe(true);
          });
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);
});
