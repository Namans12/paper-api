import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Reading } from '../src/domain/types';
import { renderSheetRaster, type FixtureMark } from '../src/sheet/raster';
import { defaultPhotoOptions, simulatePhoto } from '../src/sheet/simulate';
import { classify, judge, type Answer } from './capture-test';

const SID = 'abcdefghik';
const sheet = {
  id: SID,
  rows: Array.from({ length: 6 }, (_, i) => ({ binId: `B-${i}`, label: `Bin ${i + 1}`, printedStatus: 'ready' as const, printedRev: 1 })),
};
// row 1 unavailable, row 2 stray (uncertain), row 3 X in two boxes (double), row 4 needs-inspection
const marks: FixtureMark[] = [
  { row: 1, col: 2, kind: 'x' }, { row: 2, col: 1, kind: 'stray' },
  { row: 3, col: 0, kind: 'x' }, { row: 3, col: 2, kind: 'x' }, { row: 4, col: 1, kind: 'x' },
];
let dir = '';
let file = '';
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-api-judge-'));
  const p = simulatePhoto(renderSheetRaster(sheet, marks), defaultPhotoOptions(7));
  const png = new PNG({ width: p.width, height: p.height });
  png.data = Buffer.from(p.data);
  file = path.join(dir, 'p.png');
  fs.writeFileSync(file, PNG.sync.write(png));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const ans = (rows: Answer['rows'], sheetId = SID): Answer => ({ file: 'p.png', sheetId, rows });

describe('judge', () => {
  const blank: Reading = { kind: 'blank' }, mark: Reading = { kind: 'mark', status: 'ready' };
  const unc: Reading = { kind: 'uncertain' }, dbl: Reading = { kind: 'double', statuses: ['ready', 'unavailable'] };
  it('ambiguous read as unclear is ok, as blank is flag, as a clean mark is wrong', () => {
    expect(judge('ambiguous', unc)).toBe('ok');
    expect(judge('ambiguous', dbl)).toBe('ok');
    expect(judge('ambiguous', blank)).toBe('flag');
    expect(judge('ambiguous', mark)).toBe('wrong');
  });
  it('unclear on a clear or blank row is flag; confident disagreement is wrong', () => {
    expect(judge('ready', unc)).toBe('flag');
    expect(judge('blank', dbl)).toBe('flag');
    expect(judge('blank', mark)).toBe('wrong');
    expect(judge('ready', blank)).toBe('wrong');
    expect(judge('unavailable', mark)).toBe('wrong');
    expect(judge('ready', mark)).toBe('ok');
    expect(judge('blank', blank)).toBe('ok');
  });
});

describe('classify', () => {
  const good: Answer['rows'] = ['blank', 'unavailable', 'ambiguous', 'ambiguous', 'needs-inspection', 'blank'];
  it('all correct is passing', () => {
    expect(classify(ans(good), file).verdict).toBe('passing');
  });
  it('ambiguous row that was read as blank is flagged', () => {
    // row 0 is blank on paper; declaring it ambiguous makes it an ambiguous-as-blank case
    expect(classify(ans(['ambiguous', ...good.slice(1)]), file).verdict).toBe('flagged');
  });
  it('ambiguous row that was read as a clean mark is incorrect', () => {
    expect(classify(ans([good[0], 'ambiguous', ...good.slice(2)]), file).verdict).toBe('incorrect');
  });
  it('a mark on a row declared blank is incorrect', () => {
    expect(classify(ans([good[0], 'blank', ...good.slice(2)]), file).verdict).toBe('incorrect');
  });
  it('wrong sheetId is incorrect', () => {
    expect(classify(ans(good, 'mnpqrstuvw'), file).verdict).toBe('incorrect');
  });
  it('unclear reading on a non-ambiguous row is flagged', () => {
    expect(classify(ans([good[0], good[1], 'blank', ...good.slice(3)]), file).verdict).toBe('flagged');
  });
  it('a missing file is rejected', () => {
    expect(classify(ans(good), null).verdict).toBe('rejected');
  });
});
