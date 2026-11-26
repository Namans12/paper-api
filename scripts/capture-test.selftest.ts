/** Self-test for the capture harness using synthetic fixtures. Run: npx tsx scripts/capture-test.selftest.ts */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { renderSheetRaster, type FixtureMark } from '../src/sheet/raster';
import { classify, type Answer, type Verdict } from './capture-test';
import { defaultPhotoOptions, simulatePhoto } from '../src/sheet/simulate';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-api-captures-'));
const mk = (id: string) => ({
  id,
  rows: Array.from({ length: 6 }, (_, i) => ({ binId: `B-${i}`, label: `Bin ${i + 1}`, printedStatus: 'ready' as const, printedRev: 1 })),
});
const cases: { file: string; id: string; seed: number; marks: FixtureMark[]; rows: string[] }[] = [
  { file: 'a.png', id: 'abcdefghik', seed: 7, marks: [{ row: 1, col: 2, kind: 'x' }, { row: 3, col: 1, kind: 'x' }, { row: 4, col: 2, kind: 'x' }],
    rows: ['blank', 'unavailable', 'blank', 'needs-inspection', 'unavailable', 'blank'] },
  { file: 'b.PNG', id: 'mnpqrstuvw', seed: 3, marks: [{ row: 0, col: 0, kind: 'x' }, { row: 2, col: 1, kind: 'stray' }],
    rows: ['ready', 'blank', 'ambiguous', 'blank', 'blank', 'blank'] },
  { file: 'c.png', id: 'xyz2345678', seed: 11, marks: [{ row: 5, col: 1, kind: 'x' }, { row: 2, col: 0, kind: 'x' }, { row: 2, col: 2, kind: 'x' }],
    rows: ['blank', 'blank', 'ambiguous', 'blank', 'blank', 'needs-inspection'] },
];
for (const c of cases) {
  const p = simulatePhoto(renderSheetRaster(mk(c.id), c.marks), defaultPhotoOptions(c.seed));
  const png = new PNG({ width: p.width, height: p.height });
  png.data = Buffer.from(p.data);
  fs.writeFileSync(path.join(dir, c.file), PNG.sync.write(png));
}
fs.writeFileSync(path.join(dir, 'answers.json'), JSON.stringify(cases.map((c) => ({ file: c.file, sheetId: c.id, rows: c.rows }))));

// Crafted negative fixtures: classifier must give exactly these verdicts.
const writePng = (file: string, p: { width: number; height: number; data: Uint8ClampedArray }) => {
  const png = new PNG({ width: p.width, height: p.height });
  png.data = Buffer.from(p.data);
  fs.mkdirSync(path.join(dir, 'neg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'neg', file), PNG.sync.write(png));
};
const SID = 'abcdefghik';
writePng('base.png', simulatePhoto(renderSheetRaster(mk(SID), [{ row: 1, col: 2, kind: 'x' }, { row: 3, col: 1, kind: 'x' }]), defaultPhotoOptions(7)));
writePng('stray.png', simulatePhoto(renderSheetRaster(mk(SID), [{ row: 1, col: 2, kind: 'x' }, { row: 4, col: 1, kind: 'stray' }]), defaultPhotoOptions(5)));
const T = ['blank', 'unavailable', 'blank', 'needs-inspection', 'blank', 'blank'];
const withRow = (i: number, v: string) => T.map((x, k) => (k === i ? v : x));
const negatives: [string, string, Answer, Verdict][] = [
  ['control: all correct', 'base.png', { file: 'base.png', sheetId: SID, rows: T as Answer['rows'] }, 'passing'],
  ['sheetId case/space normalised', 'base.png', { file: 'base.png', sheetId: ' ABCDEFGHIK ', rows: T as Answer['rows'] }, 'passing'],
  ['(a) blank row declared ambiguous', 'base.png', { file: 'base.png', sheetId: SID, rows: withRow(0, 'ambiguous') as Answer['rows'] }, 'flagged'],
  ['(b) mark on row declared blank', 'base.png', { file: 'base.png', sheetId: SID, rows: withRow(1, 'blank') as Answer['rows'] }, 'incorrect'],
  ['(c) wrong sheetId', 'base.png', { file: 'base.png', sheetId: 'zzzzzzzzzz', rows: T as Answer['rows'] }, 'incorrect'],
  ['(d) wrong status', 'base.png', { file: 'base.png', sheetId: SID, rows: withRow(1, 'ready') as Answer['rows'] }, 'incorrect'],
  ['(e) uncertain on non-ambiguous truth', 'stray.png', { file: 'stray.png', sheetId: SID, rows: withRow(3, 'blank') as Answer['rows'] }, 'flagged'],
  ['(f) mark on row declared ambiguous', 'base.png', { file: 'base.png', sheetId: SID, rows: withRow(1, 'ambiguous') as Answer['rows'] }, 'incorrect'],
  ['(g) blank read on marked truth', 'base.png', { file: 'base.png', sheetId: SID, rows: withRow(0, 'ready') as Answer['rows'] }, 'incorrect'],
];
let negFail = 0;
console.log('\nClassifier checks');
for (const [name, f, a, want] of negatives) {
  const got = classify(a, path.join(dir, 'neg', f)).verdict;
  if (got !== want) negFail++;
  console.log(`  ${got === want ? 'ok  ' : 'FAIL'} ${name}: ${got} (want ${want})`);
}

const run = (args: string[]) => spawnSync('npx', ['tsx', 'scripts/capture-test.ts', '--dir', dir, ...args], { encoding: 'utf8' });
const good = run(['--min', '3']);
process.stdout.write(good.stdout + good.stderr);
const strict = run([]);
const missing = spawnSync('npx', ['tsx', 'scripts/capture-test.ts', '--dir', path.join(dir, 'nope')], { encoding: 'utf8' });
console.log(`\nexit with --min 3: ${good.status} (expect 0)\nexit default (3 photos < 8): ${strict.status} (expect 1)\nexit missing dir/answers: ${missing.status} (expect 2)`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(negFail === 0 && good.status === 0 && strict.status === 1 && missing.status === 2 ? 0 : 1);
