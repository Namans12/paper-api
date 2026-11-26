/**
 * Real-photo capture harness: reads phone photos of marked sheets, compares what
 * the reader sees with the answers you wrote down BEFORE marking, and prints a
 * strict pass/fail table. Run: npm run capture-test [-- --dir captures] [--min 8]
 */
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { Reading, Status } from '../src/domain/types';
import { STATUSES } from '../src/domain/types';
import { readSheet } from '../src/reader/read';
import type { RGBA } from '../src/sheet/raster';

type Truth = 'blank' | Status | 'ambiguous';
interface Answer { file: string; sheetId: string; rows: Truth[] }
type Verdict = 'passing' | 'rejected' | 'flagged' | 'incorrect';
interface Outcome { file: string; verdict: Verdict; lines: string[] }

const TRUTHS: string[] = ['blank', ...STATUSES, 'ambiguous'];
const ROWS = 6;
const PASS_RATIO = 0.8, WANTED = 10;

function die(msg: string, code = 2): never {
  console.error(msg);
  process.exit(code);
}

function parseArgs(argv: string[]): { dir: string; min: number } {
  let dir = 'captures', min = 8;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) dir = argv[++i];
    else if (argv[i] === '--min' && argv[i + 1]) min = Number(argv[++i]);
    else die(`Unknown or incomplete argument "${argv[i]}". Usage: capture-test [--dir <path>] [--min <n>]`);
  }
  if (!Number.isInteger(min) || min < 1) die('--min must be a positive whole number.');
  return { dir, min };
}

function loadAnswers(dir: string): Answer[] {
  const file = path.join(dir, 'answers.json');
  if (!fs.existsSync(file))
    die(
      `No answers file found at ${file}.\n` +
        `Copy captures/answers.example.json to ${file} and fill it in BEFORE you mark the sheets.\n` +
        `Step-by-step instructions: docs/capture-test.md`,
    );
  let data: unknown;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { die(`${file} is not valid JSON: ${(e as Error).message}`); }
  if (!Array.isArray(data)) die(`${file} must be a JSON list of { file, sheetId, rows } entries.`);
  const seen = new Set<string>();
  data.forEach((a: any, i: number) => {
    const where = `${file}, entry ${i + 1}`;
    if (!a || typeof a.file !== 'string' || typeof a.sheetId !== 'string' || !Array.isArray(a.rows))
      die(`${where}: needs "file", "sheetId" and "rows".`);
    if (seen.has(a.file)) die(`${where}: "${a.file}" is listed twice.`);
    seen.add(a.file);
    if (a.rows.length !== ROWS) die(`${where} (${a.file}): "rows" must list exactly ${ROWS} values (bins 1 to ${ROWS}), found ${a.rows.length}.`);
    for (const v of a.rows) if (!TRUTHS.includes(v)) die(`${where} (${a.file}): "${v}" is not allowed. Use one of: ${TRUTHS.join(', ')}.`);
  });
  return data as Answer[];
}

function findFile(dir: string, name: string): string | null {
  const exact = path.join(dir, name);
  if (fs.existsSync(exact)) return exact;
  const hit = fs.readdirSync(dir).find((f) => f.toLowerCase() === name.toLowerCase());
  return hit ? path.join(dir, hit) : null;
}

function decode(file: string): RGBA {
  const ext = path.extname(file).toLowerCase();
  const buf = fs.readFileSync(file);
  if (ext === '.png') {
    const p = PNG.sync.read(buf);
    return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data.buffer, p.data.byteOffset, p.data.length) };
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    // EXIF orientation is ignored on purpose: the reader handles rotation itself.
    const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    return { width: j.width, height: j.height, data: new Uint8ClampedArray(j.data.buffer, j.data.byteOffset, j.data.length) };
  }
  if (ext === '.heic' || ext === '.heif') throw new Error('HEIC is not supported. Export the photo as JPEG (see docs/capture-test.md).');
  throw new Error(`Unsupported file type "${ext}". Use .jpg, .jpeg or .png.`);
}

const show = (r: Reading): string =>
  r.kind === 'blank' ? 'blank' : r.kind === 'mark' ? r.status : r.kind === 'double' ? `double(${r.statuses.join('+')})` : 'uncertain';

/** 'ok' | 'flag' (unclear but honest) | 'wrong' (a confident wrong answer). */
function judge(truth: Truth, r: Reading): 'ok' | 'flag' | 'wrong' {
  const unclear = r.kind === 'uncertain' || r.kind === 'double';
  if (truth === 'ambiguous') return unclear ? 'ok' : 'wrong'; // a clean read of an unclear mark would pass as a clean edit
  if (unclear) return 'flag';
  if (truth === 'blank') return r.kind === 'blank' ? 'ok' : 'wrong';
  return r.kind === 'mark' && r.status === truth ? 'ok' : 'wrong';
}

function classify(a: Answer, file: string | null): Outcome {
  const out = (verdict: Verdict, lines: string[]): Outcome => ({ file: a.file, verdict, lines });
  if (!file) return out('rejected', ['file not found in the captures folder']);
  let img: RGBA;
  try { img = decode(file); } catch (e) { return out('rejected', [`could not decode: ${(e as Error).message}`]); }
  const r = readSheet(img);
  if (!r.ok) return out('rejected', [`${r.reason}: ${r.message}`]);
  const lines: string[] = [];
  let wrong = false, flag = false;
  if (r.sheetId !== a.sheetId) {
    wrong = true;
    lines.push(`WRONG sheet: read ${r.sheetId}, expected ${a.sheetId}`);
  }
  if (r.rows.length !== ROWS) { wrong = true; lines.push(`WRONG: reader returned ${r.rows.length} rows, expected ${ROWS}`); }
  a.rows.forEach((truth, i) => {
    const read = r.rows[i]?.reading;
    if (!read) return;
    const j = judge(truth, read);
    if (j === 'wrong') wrong = true;
    if (j === 'flag') flag = true;
    lines.push(`bin ${i + 1}: expected ${truth}, read ${show(read)}${j === 'ok' ? '' : j === 'flag' ? '  <- FLAGGED' : '  <- INCORRECT'}`);
  });
  return out(wrong ? 'incorrect' : flag ? 'flagged' : 'passing', lines);
}

function main(): void {
  const { dir, min } = parseArgs(process.argv.slice(2));
  const answers = loadAnswers(dir);
  const outcomes = answers.map((a) => classify(a, findFile(dir, a.file)));

  const listed = new Set(answers.map((a) => a.file.toLowerCase()));
  const unlisted = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|heic|heif)$/i.test(f) && !listed.has(f.toLowerCase()));

  console.log(`\nPaper API capture test  (${dir})\n`);
  for (const o of outcomes) {
    console.log(`${o.verdict.toUpperCase().padEnd(10)} ${o.file}`);
    for (const l of o.lines) console.log(`           ${l}`);
  }
  if (unlisted.length) console.log(`\nNote: not in answers.json, so NOT counted: ${unlisted.join(', ')}`);

  const count = (v: Verdict) => outcomes.filter((o) => o.verdict === v).length;
  const total = outcomes.length, passing = count('passing'), incorrect = count('incorrect');
  console.log('\nTotals');
  console.log(`  passing   ${passing}\n  flagged   ${count('flagged')}\n  rejected  ${count('rejected')}\n  incorrect ${incorrect}\n  photos    ${total}`);
  if (total < WANTED) console.log(`\nNeed ${WANTED} photos; have ${total}.${min < 8 ? ` (--min ${min} set: this run is NOT the official test.)` : ' Fewer than 10 still needs at least 8 passing.'}`);

  const ok = passing >= min && total > 0 && passing / total >= PASS_RATIO && incorrect === 0;
  console.log(`\nPass bar: at least 8 of 10 passing and zero incorrect (min passing here: ${min}, at least ${PASS_RATIO * 100}% of photos).`);
  console.log(ok ? 'RESULT: PASS' : `RESULT: FAIL${incorrect ? ' (incorrect readings are never acceptable)' : ''}`);
  process.exit(ok ? 0 : 1);
}

main();
