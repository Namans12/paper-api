/** Self-test for the capture harness using synthetic fixtures. Run: npx tsx scripts/capture-test.selftest.ts */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { renderSheetRaster, type FixtureMark } from '../src/sheet/raster';
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

const run = (args: string[]) => spawnSync('npx', ['tsx', 'scripts/capture-test.ts', '--dir', dir, ...args], { encoding: 'utf8' });
const good = run(['--min', '3']);
process.stdout.write(good.stdout + good.stderr);
const strict = run([]);
const missing = spawnSync('npx', ['tsx', 'scripts/capture-test.ts', '--dir', path.join(dir, 'nope')], { encoding: 'utf8' });
console.log(`\nexit with --min 3: ${good.status} (expect 0)\nexit default (3 photos < 8): ${strict.status} (expect 1)\nexit missing dir/answers: ${missing.status} (expect 2)`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(good.status === 0 && strict.status === 1 && missing.status === 2 ? 0 : 1);
