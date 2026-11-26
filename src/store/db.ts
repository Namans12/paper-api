import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import { resolveRow } from '../domain/reconcile';
import type {
  Bin, Receipt, ReceiptRow, Reading, RowDecision, RowInput, Sheet, Status,
} from '../domain/types';
import { newSheetId } from './ids';

export const DB_NAME = 'paper-api';

export const SEED_BINS: ReadonlyArray<Pick<Bin, 'id' | 'label' | 'status'>> = [
  { id: 'bin-1', label: 'Bin 1 · Cordless drills', status: 'ready' },
  { id: 'bin-2', label: 'Bin 2 · Ladders', status: 'ready' },
  { id: 'bin-3', label: 'Bin 3 · Tile saw', status: 'needs-inspection' },
  { id: 'bin-4', label: 'Bin 4 · Pressure washer', status: 'ready' },
  { id: 'bin-5', label: 'Bin 5 · Hedge trimmer', status: 'unavailable' },
  { id: 'bin-6', label: 'Bin 6 · Camping stoves', status: 'ready' },
];

export interface ReviewRow { binId: string; label: string; input: RowInput }
export type PrepareResult =
  | { kind: 'unknown-sheet' } | { kind: 'receipt'; receipt: Receipt }
  | { kind: 'review'; sheet: Sheet; rows: ReviewRow[] };
export interface ConfirmRequest {
  sheetId: string;
  rows: Array<{ binId: string; deskRevSeen: number; observed: Reading; decision: RowDecision }>;
}
export type ConfirmResult =
  | { kind: 'committed'; receipt: Receipt } | { kind: 'already'; receipt: Receipt }
  | { kind: 'stale'; binIds: string[] } | { kind: 'unresolved'; binIds: string[] }
  | { kind: 'unknown-sheet' } | { kind: 'mismatch' };
export interface Store {
  listBins(): Promise<Bin[]>;
  setBinStatus(binId: string, status: Status): Promise<Bin>;
  issueSheet(): Promise<Sheet>;
  getSheet(id: string): Promise<Sheet | undefined>;
  listSheets(): Promise<Array<{ sheet: Sheet; receipt?: Receipt }>>;
  getReceipt(sheetId: string): Promise<Receipt | undefined>;
  prepareReview(sheetId: string, readings: Reading[]): Promise<PrepareResult>;
  confirm(req: ConfirmRequest): Promise<ConfirmResult>;
  reset(): Promise<void>;
  close(): void;
}

interface PaperDB extends DBSchema {
  bins: { key: string; value: Bin };
  sheets: { key: string; value: Sheet };
  receipts: { key: string; value: Receipt };
}

function seedBin(b: (typeof SEED_BINS)[number], now: string): Bin {
  return { ...b, rev: 1, updatedAt: now, source: 'seed' };
}

async function seedIfEmpty(db: IDBPDatabase<PaperDB>): Promise<void> {
  const now = new Date().toISOString();
  const tx = db.transaction('bins', 'readwrite');
  if ((await tx.store.count()) === 0) {
    for (const b of SEED_BINS) await tx.store.put(seedBin(b, now));
  }
  await tx.done;
}

export async function openStore(name: string = DB_NAME): Promise<Store> {
  const db = await openDB<PaperDB>(name, 1, {
    upgrade(d) {
      d.createObjectStore('bins', { keyPath: 'id' });
      d.createObjectStore('sheets', { keyPath: 'id' });
      d.createObjectStore('receipts', { keyPath: 'sheetId' });
    },
  });
  await seedIfEmpty(db);

  const sortedBins = async () => (await db.getAll('bins')).sort((a, b) => a.id.localeCompare(b.id));

  async function confirm(req: ConfirmRequest): Promise<ConfirmResult> {
    const confirmedAt = new Date().toISOString();
    const tx = db.transaction(['bins', 'sheets', 'receipts'], 'readwrite');
    // Inside this transaction only IDB requests are awaited, or it would auto-commit.
    const run = async (): Promise<ConfirmResult> => {
      const sheet = await tx.objectStore('sheets').get(req.sheetId);
      if (!sheet) return { kind: 'unknown-sheet' };
      const existing = await tx.objectStore('receipts').get(req.sheetId);
      if (existing) return { kind: 'already', receipt: existing };

      const sheetIds = sheet.rows.map((r) => r.binId);
      const reqIds = req.rows.map((r) => r.binId);
      const sameSet =
        reqIds.length === sheetIds.length &&
        new Set(reqIds).size === reqIds.length &&
        sheetIds.every((id) => reqIds.includes(id));
      if (!sameSet) return { kind: 'mismatch' };

      const bins = new Map<string, Bin>();
      for (const id of sheetIds) {
        const bin = await tx.objectStore('bins').get(id);
        if (bin) bins.set(id, bin);
      }
      const reqById = new Map(req.rows.map((r) => [r.binId, r]));
      const stale = sheet.rows
        .filter((row) => bins.get(row.binId)?.rev !== reqById.get(row.binId)!.deskRevSeen)
        .map((row) => row.binId);
      if (stale.length) return { kind: 'stale', binIds: stale };

      const unresolved: string[] = [];
      const writes: Bin[] = [];
      const rows: ReceiptRow[] = [];
      let appliedCount = 0;
      for (const row of sheet.rows) {
        const bin = bins.get(row.binId)!;
        const r = reqById.get(row.binId)!;
        const input: RowInput = {
          printed: row.printedStatus, printedRev: row.printedRev,
          desk: bin.status, deskRev: bin.rev, reading: r.observed,
        };
        const res = resolveRow(input, r.decision);
        if (res.state === 'unresolved') {
          unresolved.push(row.binId);
          continue;
        }
        if (res.write) {
          appliedCount++;
          writes.push({ ...bin, status: res.finalStatus, rev: bin.rev + 1, updatedAt: confirmedAt, source: `sheet:${sheet.id}` });
        }
        const receiptRow: ReceiptRow = {
          binId: row.binId, label: row.label, printed: row.printedStatus,
          deskAtReview: bin.status, deskRevAtReview: bin.rev, observed: r.observed,
          outcome: res.outcome, finalStatus: res.finalStatus,
        };
        if (r.decision.reading) receiptRow.corrected = r.decision.reading;
        rows.push(receiptRow);
      }
      if (unresolved.length) return { kind: 'unresolved', binIds: unresolved };

      const receipt: Receipt = { sheetId: sheet.id, confirmedAt, rows, appliedCount };
      for (const b of writes) await tx.objectStore('bins').put(b);
      await tx.objectStore('receipts').add(receipt);
      return { kind: 'committed', receipt };
    };
    tx.done.catch(() => {}); // abort paths are handled below; avoid an unhandled rejection
    try {
      const result = await run();
      await tx.done;
      return result;
    } catch (e) {
      // A ConstraintError on the receipt add aborts the whole transaction (bins rolled back):
      // another confirmation won the race, so return its receipt.
      if ((e as { name?: string }).name === 'ConstraintError') {
        const receipt = await db.get('receipts', req.sheetId);
        if (receipt) return { kind: 'already', receipt };
      }
      throw e;
    }
  }

  return {
    listBins: sortedBins,

    async setBinStatus(binId, status) {
      const now = new Date().toISOString();
      const tx = db.transaction('bins', 'readwrite');
      const bin = await tx.store.get(binId);
      if (!bin) {
        await tx.done;
        throw new Error(`Unknown bin ${binId}`);
      }
      const next: Bin = { ...bin, status, rev: bin.rev + 1, updatedAt: now, source: 'desk' };
      await tx.store.put(next);
      await tx.done;
      return next;
    },

    async issueSheet() {
      const issuedAt = new Date().toISOString();
      const id = newSheetId();
      const tx = db.transaction(['bins', 'sheets'], 'readwrite');
      const bins = (await tx.objectStore('bins').getAll()).sort((a, b) => a.id.localeCompare(b.id));
      const sheet: Sheet = {
        id, layout: 'stocktake-v1', issuedAt,
        rows: bins.map((b) => ({ binId: b.id, label: b.label, printedStatus: b.status, printedRev: b.rev })),
      };
      await tx.objectStore('sheets').add(sheet);
      await tx.done;
      return sheet;
    },

    getSheet: (id) => db.get('sheets', id),

    async listSheets() {
      const tx = db.transaction(['sheets', 'receipts'], 'readonly');
      const sheets = await tx.objectStore('sheets').getAll();
      const receipts = await tx.objectStore('receipts').getAll();
      const byId = new Map(receipts.map((r) => [r.sheetId, r]));
      return sheets
        .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
        .map((sheet) => ({ sheet, receipt: byId.get(sheet.id) }));
    },

    getReceipt: (sheetId) => db.get('receipts', sheetId),

    async prepareReview(sheetId, readings) {
      const tx = db.transaction(['bins', 'sheets', 'receipts'], 'readonly');
      const sheet = await tx.objectStore('sheets').get(sheetId);
      if (!sheet) return { kind: 'unknown-sheet' };
      const receipt = await tx.objectStore('receipts').get(sheetId);
      if (receipt) return { kind: 'receipt', receipt };
      if (readings.length !== sheet.rows.length) {
        throw new Error(`Expected ${sheet.rows.length} readings, got ${readings.length}`);
      }
      const rows: ReviewRow[] = [];
      for (let i = 0; i < sheet.rows.length; i++) {
        const row = sheet.rows[i];
        const bin = await tx.objectStore('bins').get(row.binId);
        if (!bin) throw new Error(`Bin ${row.binId} missing`);
        rows.push({
          binId: row.binId, label: row.label,
          input: {
            printed: row.printedStatus, printedRev: row.printedRev,
            desk: bin.status, deskRev: bin.rev, reading: readings[i],
          },
        });
      }
      return { kind: 'review', sheet, rows };
    },

    confirm,

    async reset() {
      const now = new Date().toISOString();
      const tx = db.transaction(['bins', 'sheets', 'receipts'], 'readwrite');
      await Promise.all([tx.objectStore('bins').clear(), tx.objectStore('sheets').clear(), tx.objectStore('receipts').clear()]);
      for (const b of SEED_BINS) await tx.objectStore('bins').put(seedBin(b, now));
      await tx.done;
    },

    close: () => db.close(),
  };
}
