import { describe, expect, it } from 'vitest';
import type { ReviewRow } from '../store/db';
import type { Reading, Status } from '../domain/types';
import { boxCenterFractions, isFixtureFileName, canConfirm, decide, initReview, refreshAfterStale, rowView, sortedRows, toConfirmRequest } from './review-model';

const row = (n: number, printed: Status, printedRev: number, desk: Status, deskRev: number): ReviewRow => ({
  binId: `bin-${n}`,
  label: `Bin ${n}`,
  input: { printed, printedRev, desk, deskRev, reading: { kind: 'blank' } },
});
const mark = (status: Status): Reading => ({ kind: 'mark', status });
const blank: Reading = { kind: 'blank' };

// bin-4: printed Ready, desk changed to Unavailable (rev 2), paper says Needs inspection => conflict
// bin-2: desk unchanged, paper says Needs inspection => clean edit; bin-5: agreement
const rows = (): ReviewRow[] => [
  row(1, 'ready', 1, 'ready', 1),
  row(2, 'ready', 1, 'ready', 1),
  row(3, 'ready', 1, 'ready', 1),
  row(4, 'ready', 1, 'unavailable', 2),
  row(5, 'unavailable', 1, 'unavailable', 1),
  row(6, 'ready', 1, 'ready', 1),
];
const readings = (): Reading[] => [blank, mark('needs-inspection'), blank, mark('needs-inspection'), mark('unavailable'), blank];
const get = (s: ReturnType<typeof initReview>, id: string) => s.rows.find((r) => r.binId === id)!;

describe('review-model', () => {
  it('bin 4 fixture cannot confirm until bin 4 is decided', () => {
    let s = initReview('S1', rows(), readings());
    expect(rowView(get(s, 'bin-4')).badge).toBe('Conflict');
    expect(rowView(get(s, 'bin-2')).badge).toBe('Clean edit');
    expect(rowView(get(s, 'bin-5')).badge).toBe('Agrees');
    expect(rowView(get(s, 'bin-1')).badge).toBe('Unchanged');
    expect(canConfirm(s)).toBe(false);
    s = decide(s, 'bin-4', { choice: 'keep-desk' });
    expect(rowView(get(s, 'bin-4')).badge).toBe('Kept desk');
    expect(canConfirm(s)).toBe(true);
  });

  it('badges for accept-paper and defer', () => {
    let s = initReview('S1', rows(), readings());
    s = decide(s, 'bin-2', { choice: 'accept-paper' });
    expect(rowView(get(s, 'bin-2')).badge).toBe('Applied');
    s = decide(s, 'bin-4', { choice: 'defer' });
    expect(rowView(get(s, 'bin-4')).badge).toBe('Deferred');
  });

  it('sorts conflicts first, then check-mark rows, then sheet order', () => {
    const r = rows();
    const rd = readings();
    rd[2] = { kind: 'uncertain' };
    let s = initReview('S1', r, rd);
    expect(sortedRows(s).map((x) => x.binId)).toEqual(['bin-4', 'bin-3', 'bin-1', 'bin-2', 'bin-5', 'bin-6']);
    s = decide(s, 'bin-4', { choice: 'keep-desk' });
    expect(sortedRows(s)[0].binId).toBe('bin-4');
  });

  it('toConfirmRequest carries deskRevSeen from the reviewed input', () => {
    const s = decide(initReview('S1', rows(), readings()), 'bin-4', { choice: 'keep-desk' });
    const req = toConfirmRequest(s);
    expect(req.sheetId).toBe('S1');
    expect(req.rows).toHaveLength(6);
    const r4 = req.rows.find((r) => r.binId === 'bin-4')!;
    expect(r4.deskRevSeen).toBe(2);
    expect(r4.observed).toEqual(mark('needs-inspection'));
    expect(r4.decision).toEqual({ choice: 'keep-desk' });
  });

  it('refreshAfterStale resets only stale rows and sets the notice', () => {
    let s = initReview('S1', rows(), readings());
    s = decide(s, 'bin-4', { choice: 'keep-desk' });
    s = decide(s, 'bin-2', { choice: 'accept-paper' });
    const fresh = rows();
    fresh[1] = row(2, 'ready', 1, 'needs-inspection', 2);
    const next = refreshAfterStale(s, fresh, ['bin-2']);
    expect(get(next, 'bin-2').decision).toEqual({});
    expect(get(next, 'bin-2').staleNotice).toBe('Desk changed to Needs inspection while you were reviewing');
    expect(get(next, 'bin-2').input.deskRev).toBe(2);
    expect(get(next, 'bin-2').observed).toEqual(mark('needs-inspection'));
    expect(get(next, 'bin-4').decision).toEqual({ choice: 'keep-desk' });
    expect(get(next, 'bin-4').staleNotice).toBeUndefined();
    // bin-2 now agrees with the desk
    expect(rowView(get(next, 'bin-2')).badge).toBe('Agrees');
  });

  it('a needs-reading row corrected to a mark is re-classified', () => {
    const rd = readings();
    rd[3] = { kind: 'double', statuses: ['ready', 'unavailable'] };
    let s = initReview('S1', rows(), rd);
    expect(rowView(get(s, 'bin-4')).badge).toBe('Check mark');
    expect(canConfirm(s)).toBe(false);
    s = decide(s, 'bin-4', { reading: mark('needs-inspection') });
    expect(rowView(get(s, 'bin-4')).badge).toBe('Conflict');
    expect(canConfirm(s)).toBe(false);
    s = decide(s, 'bin-4', { reading: mark('needs-inspection'), choice: 'accept-paper' });
    expect(canConfirm(s)).toBe(true);
    s = decide(s, 'bin-4', { reading: blank });
    expect(rowView(get(s, 'bin-4')).badge).toBe('Unchanged');
  });

  it('column label positions follow the layout and fixture files are recognised', () => {
    const f = boxCenterFractions();
    expect(f).toHaveLength(3);
    expect(f[0]).toBeCloseTo((112 + 6 - 14) / 182);
    expect(f[2]).toBeCloseTo((172 + 6 - 14) / 182);
    expect(isFixtureFileName('fixture-abc.png')).toBe(true);
    expect(isFixtureFileName('IMG_1.jpg')).toBe(false);
  });
});
