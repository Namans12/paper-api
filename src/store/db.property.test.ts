import 'fake-indexeddb/auto';
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { openStore, type ConfirmRequest, type ConfirmResult } from './db';
import { STATUSES, type Bin, type Reading, type RowDecision, type Status } from '../domain/types';

const status = fc.constantFrom<Status>(...STATUSES);
const reading: fc.Arbitrary<Reading> = fc.oneof(
  fc.constant<Reading>({ kind: 'blank' }),
  status.map((s): Reading => ({ kind: 'mark', status: s })),
  fc.array(status, { minLength: 2, maxLength: 3 }).map((statuses): Reading => ({ kind: 'double', statuses })),
  fc.constant<Reading>({ kind: 'uncertain' }),
);
const decision: fc.Arbitrary<RowDecision> = fc.record(
  {
    choice: fc.constantFrom('accept-paper' as const, 'keep-desk' as const, 'defer' as const),
    reading: fc.oneof(
      fc.constant<Reading>({ kind: 'blank' }),
      status.map((s): Reading => ({ kind: 'mark', status: s })),
    ),
  },
  { requiredKeys: [] },
);

type Cmd =
  | { t: 'deskEdit'; bin: number; status: Status }
  | { t: 'prepare'; readings: Reading[] }
  | { t: 'confirm'; decisions: RowDecision[] }
  | { t: 'concurrentConfirm'; decisions: RowDecision[] }
  | { t: 'rescan' };

const cmd: fc.Arbitrary<Cmd> = fc.oneof(
  fc.record({ t: fc.constant('deskEdit' as const), bin: fc.integer({ min: 0, max: 5 }), status }),
  fc.record({ t: fc.constant('prepare' as const), readings: fc.array(reading, { minLength: 6, maxLength: 6 }) }),
  fc.record({ t: fc.constant('confirm' as const), decisions: fc.array(decision, { minLength: 6, maxLength: 6 }) }),
  fc.record({ t: fc.constant('concurrentConfirm' as const), decisions: fc.array(decision, { minLength: 6, maxLength: 6 }) }),
  fc.record({ t: fc.constant('rescan' as const) }),
);

const byId = (bins: Bin[]) => Object.fromEntries(bins.map((b) => [b.id, b]));

describe('store invariants under command sequences', () => {
  it('keeps one receipt, applies only applied rows, never overwrites newer desk edits', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(cmd, { minLength: 1, maxLength: 14 }), async (cmds) => {
        const store = await openStore(crypto.randomUUID());
        try {
          const sheet = await store.issueSheet();
          const ids = sheet.rows.map((r) => r.binId);
          let prepared: { readings: Reading[]; revs: number[] } | undefined;
          let committed = false;
          // Expected rev per bin: 1 + desk edits + applied writes.
          const expectedRev: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 1]));

          const buildReq = (decisions: RowDecision[]): ConfirmRequest => ({
            sheetId: sheet.id,
            rows: ids.map((binId, i) => ({
              binId, deskRevSeen: prepared!.revs[i], observed: prepared!.readings[i], decision: decisions[i],
            })),
          });

          const check = async (before: Record<string, Bin>, results: ConfirmResult[], revsAtConfirm?: number[]) => {
            const after = byId(await store.listBins());
            const receipt = await store.getReceipt(sheet.id);
            const receipts = (await store.listSheets()).filter((s) => s.receipt).length;
            expect(receipts).toBeLessThanOrEqual(1); // (a)
            const committedResults = results.filter((r) => r.kind === 'committed');
            expect(committedResults.length).toBeLessThanOrEqual(1);
            if (committedResults.length === 1 && receipt) {
              committed = true;
              for (const row of receipt.rows) {
                const applied = row.outcome === 'applied';
                // (b) + (d)
                if (applied) {
                  expect(after[row.binId].rev).toBe(before[row.binId].rev + 1);
                  expect(after[row.binId].status).toBe(row.finalStatus);
                  expectedRev[row.binId] += 1;
                } else {
                  expect(after[row.binId].rev).toBe(before[row.binId].rev);
                  expect(after[row.binId].status).toBe(before[row.binId].status);
                }
              }
              expect(receipt.appliedCount).toBe(receipt.rows.filter((r) => r.outcome === 'applied').length);
              // (c) a commit is only possible when no sheet bin moved since prepare.
              expect(revsAtConfirm).toEqual(prepared!.revs);
            } else {
              for (const id of ids) expect(after[id]).toEqual(before[id]); // rejected / already: no writes
            }
            for (const id of ids) expect(after[id].rev).toBe(expectedRev[id]);
          };

          for (const c of cmds) {
            const before = byId(await store.listBins());
            if (c.t === 'deskEdit') {
              await store.setBinStatus(ids[c.bin], c.status);
              expectedRev[ids[c.bin]] += 1;
            } else if (c.t === 'prepare') {
              const p = await store.prepareReview(sheet.id, c.readings);
              if (p.kind === 'review') {
                prepared = { readings: c.readings, revs: p.rows.map((r) => r.input.deskRev) };
                expect(p.rows.map((r) => r.input.deskRev)).toEqual(ids.map((id) => before[id].rev));
              } else expect(p.kind).toBe(committed ? 'receipt' : 'unknown-sheet');
              expect(byId(await store.listBins())).toEqual(before);
            } else if (c.t === 'rescan') {
              const p = await store.prepareReview(sheet.id, prepared?.readings ?? ids.map((): Reading => ({ kind: 'blank' })));
              expect(p.kind).toBe(committed ? 'receipt' : 'review');
              expect(byId(await store.listBins())).toEqual(before);
            } else if (prepared) {
              const revsAtConfirm = ids.map((id) => before[id].rev);
              const req = buildReq(c.decisions);
              const results =
                c.t === 'confirm' ? [await store.confirm(req)] : await Promise.all([store.confirm(req), store.confirm(req)]);
              if (!committed && !results.some((r) => r.kind === 'committed')) {
                // (c) stale prepare must be rejected as stale (or unresolved), never committed
                if (revsAtConfirm.some((r, i) => r !== prepared!.revs[i])) {
                  expect(results.every((r) => r.kind === 'stale')).toBe(true);
                }
              }
              await check(before, results, revsAtConfirm);
            }
          }
        } finally {
          store.close();
        }
      }),
      { numRuns: 60 },
    );
  });
});
