import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { SEED_BINS, openStore, type ConfirmRequest, type Store } from './db';
import { newSheetId } from './ids';
import type { Reading, RowDecision } from '../domain/types';

const open: Store[] = [];
async function fresh(): Promise<Store> {
  const s = await openStore(crypto.randomUUID());
  open.push(s);
  return s;
}
afterEach(() => {
  while (open.length) open.pop()!.close();
});

const blank: Reading = { kind: 'blank' };
const mark = (status: 'ready' | 'needs-inspection' | 'unavailable'): Reading => ({ kind: 'mark', status });

/** Spec readings: row 2 unavailable, row 4 needs-inspection, row 5 unavailable, rest blank. */
const SPEC_READINGS: Reading[] = [blank, mark('unavailable'), blank, mark('needs-inspection'), mark('unavailable'), blank];

async function prepared(store: Store, decisions: Record<string, RowDecision> = {}) {
  const sheet = await store.issueSheet();
  await store.setBinStatus('bin-4', 'unavailable');
  const p = await store.prepareReview(sheet.id, SPEC_READINGS);
  if (p.kind !== 'review') throw new Error('expected review');
  const req: ConfirmRequest = {
    sheetId: sheet.id,
    rows: p.rows.map((r) => ({
      binId: r.binId,
      deskRevSeen: r.input.deskRev,
      observed: r.input.reading,
      decision: decisions[r.binId] ?? {},
    })),
  };
  return { sheet, p, req };
}

describe('store', () => {
  it('seeds six bins at rev 1', async () => {
    const store = await fresh();
    const bins = await store.listBins();
    expect(bins.map(({ id, label, status }) => ({ id, label, status }))).toEqual(SEED_BINS);
    expect(bins.every((b) => b.rev === 1)).toBe(true);
    expect(SEED_BINS.map((b) => b.id)).toEqual(['bin-1', 'bin-2', 'bin-3', 'bin-4', 'bin-5', 'bin-6']);
  });

  it('generates sheet ids from the allowed alphabet', () => {
    for (let i = 0; i < 50; i++) expect(newSheetId()).toMatch(/^[abcdefghijkmnpqrstuvwxyz23456789]{10}$/);
  });

  it('two sheets with identical rows get distinct ids and their own baselines', async () => {
    const store = await fresh();
    const a = await store.issueSheet();
    const b = await store.issueSheet();
    expect(a.id).not.toBe(b.id);
    expect(a.rows).toEqual(b.rows);
    await store.setBinStatus('bin-1', 'unavailable');
    const c = await store.issueSheet();
    expect(c.rows[0]).toMatchObject({ binId: 'bin-1', printedStatus: 'unavailable', printedRev: 2 });
    expect((await store.getSheet(a.id))!.rows[0]).toMatchObject({ printedStatus: 'ready', printedRev: 1 });
  });

  it('prepareReview returns unknown-sheet for an unissued id', async () => {
    const store = await fresh();
    const before = await store.listBins();
    expect(await store.prepareReview('zzzzzzzzzz', [])).toEqual({ kind: 'unknown-sheet' });
    expect(await store.listBins()).toEqual(before);
  });

  it('bin 4 conflict end to end', async () => {
    const store = await fresh();
    const { sheet, p, req } = await prepared(store);
    const row4 = p.rows.find((r) => r.binId === 'bin-4')!;
    expect(row4.input).toMatchObject({ desk: 'unavailable', deskRev: 2, printed: 'ready' });

    const before = await store.listBins();
    expect(await store.confirm(req)).toEqual({ kind: 'unresolved', binIds: ['bin-4'] });
    expect(await store.listBins()).toEqual(before);
    expect(await store.getReceipt(sheet.id)).toBeUndefined();

    const withDecision: ConfirmRequest = {
      ...req,
      rows: req.rows.map((r) => (r.binId === 'bin-4' ? { ...r, decision: { choice: 'keep-desk' } } : r)),
    };
    const res = await store.confirm(withDecision);
    expect(res.kind).toBe('committed');
    if (res.kind !== 'committed') return;
    expect(res.receipt.appliedCount).toBe(1);
    const bins = Object.fromEntries((await store.listBins()).map((b) => [b.id, b]));
    expect(bins['bin-2']).toMatchObject({ status: 'unavailable', rev: 2, source: `sheet:${sheet.id}` });
    expect(bins['bin-4']).toMatchObject({ status: 'unavailable', rev: 2 });
    expect(bins['bin-5']).toMatchObject({ status: 'unavailable', rev: 1 });
  });

  it('desk edit during review returns stale and writes nothing', async () => {
    const store = await fresh();
    const { sheet, req } = await prepared(store, { 'bin-4': { choice: 'keep-desk' } });
    await store.setBinStatus('bin-2', 'needs-inspection');
    const before = await store.listBins();
    expect(await store.confirm(req)).toEqual({ kind: 'stale', binIds: ['bin-2'] });
    expect(await store.getReceipt(sheet.id)).toBeUndefined();
    expect(await store.listBins()).toEqual(before);
    const again = await store.prepareReview(sheet.id, SPEC_READINGS);
    if (again.kind !== 'review') throw new Error('expected review');
    expect(again.rows.find((r) => r.binId === 'bin-2')!.input.deskRev).toBe(2);
  });

  it('concurrent confirmations produce one receipt', async () => {
    const store = await fresh();
    const { req } = await prepared(store, { 'bin-4': { choice: 'keep-desk' } });
    const results = await Promise.all([store.confirm(req), store.confirm(req)]);
    expect(results.map((r) => r.kind).sort()).toEqual(['already', 'committed']);
    const [x, y] = results;
    if (x.kind === 'stale' || !('receipt' in x) || !('receipt' in y)) throw new Error('unexpected');
    expect(x.receipt).toEqual(y.receipt);
    const bin2 = (await store.listBins()).find((b) => b.id === 'bin-2')!;
    expect(bin2.rev).toBe(2);
  });

  it('retry after commit returns the same receipt', async () => {
    const store = await fresh();
    const { req } = await prepared(store, { 'bin-4': { choice: 'keep-desk' } });
    const first = await store.confirm(req);
    const second = await store.confirm(req);
    expect(first.kind).toBe('committed');
    expect(second.kind).toBe('already');
    if (first.kind === 'committed' && second.kind === 'already') expect(second.receipt).toEqual(first.receipt);
  });

  it('rescan of accepted sheet opens the receipt', async () => {
    const store = await fresh();
    const { sheet, req } = await prepared(store, { 'bin-4': { choice: 'keep-desk' } });
    await store.confirm(req);
    expect((await store.prepareReview(sheet.id, SPEC_READINGS)).kind).toBe('receipt');
  });

  it('mismatch when the request rows do not equal the sheet rows', async () => {
    const store = await fresh();
    const { req } = await prepared(store, { 'bin-4': { choice: 'keep-desk' } });
    expect(await store.confirm({ ...req, rows: req.rows.slice(1) })).toEqual({ kind: 'mismatch' });
    const extra = { ...req.rows[0], binId: 'bin-9' };
    expect(await store.confirm({ ...req, rows: [...req.rows, extra] })).toEqual({ kind: 'mismatch' });
    expect(await store.confirm({ ...req, rows: [...req.rows.slice(1), { ...req.rows[0], binId: 'bin-9' }] })).toEqual({
      kind: 'mismatch',
    });
  });

  it('confirm on an unknown sheet returns unknown-sheet and reset reseeds', async () => {
    const store = await fresh();
    expect(await store.confirm({ sheetId: 'zzzzzzzzzz', rows: [] })).toEqual({ kind: 'unknown-sheet' });
    await store.issueSheet();
    await store.setBinStatus('bin-1', 'unavailable');
    await store.reset();
    expect(await store.listSheets()).toEqual([]);
    expect((await store.listBins()).every((b) => b.rev === 1 && b.source === 'seed')).toBe(true);
  });

  it('deferred row is recorded on the receipt and keeps its desk value', async () => {
    const store = await fresh();
    const { req } = await prepared(store, { 'bin-4': { choice: 'defer' } });
    const res = await store.confirm(req);
    expect(res.kind).toBe('committed');
    if (res.kind !== 'committed') return;
    expect(res.receipt.rows.find((r) => r.binId === 'bin-4')).toMatchObject({ outcome: 'deferred', finalStatus: 'unavailable' });
    expect((await store.listBins()).find((b) => b.id === 'bin-4')).toMatchObject({ status: 'unavailable', rev: 2 });
  });

  it('corrected reading is recorded on the receipt', async () => {
    const store = await fresh();
    const sheet = await store.issueSheet();
    const readings: Reading[] = [{ kind: 'uncertain' }, blank, blank, blank, blank, blank];
    const p = await store.prepareReview(sheet.id, readings);
    if (p.kind !== 'review') throw new Error('expected review');
    const correction = mark('unavailable');
    const res = await store.confirm({
      sheetId: sheet.id,
      rows: p.rows.map((r) => ({
        binId: r.binId,
        deskRevSeen: r.input.deskRev,
        observed: r.input.reading,
        decision: r.binId === 'bin-1' ? { reading: correction } : {},
      })),
    });
    expect(res.kind).toBe('committed');
    if (res.kind !== 'committed') return;
    expect(res.receipt.rows[0]).toMatchObject({
      binId: 'bin-1', outcome: 'applied', corrected: correction, observed: { kind: 'uncertain' },
    });
    expect((await store.listBins())[0]).toMatchObject({ status: 'unavailable', rev: 2 });
  });

  it('prepareReview throws when readings length differs from sheet rows', async () => {
    const store = await fresh();
    const sheet = await store.issueSheet();
    await expect(store.prepareReview(sheet.id, [blank])).rejects.toThrow();
  });
});
