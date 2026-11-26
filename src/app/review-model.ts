import { BOX_SIZE, BOX_XS, rowRect } from '../sheet/layout';
import { classify, resolveRow } from '../domain/reconcile';
import { STATUS_LABEL, type Reading, type Resolution, type RowDecision } from '../domain/types';
import type { ConfirmRequest, ReviewRow } from '../store/db';

export type ReviewRowState = ReviewRow & { observed: Reading; decision: RowDecision; staleNotice?: string };
export interface ReviewState { sheetId: string; rows: ReviewRowState[] }
export type Badge = 'Unchanged' | 'Agrees' | 'Clean edit' | 'Conflict' | 'Check mark' | 'Deferred' | 'Kept desk' | 'Applied';

export function initReview(sheetId: string, rows: ReviewRow[], readings: Reading[]): ReviewState {
  if (rows.length !== readings.length) throw new Error('readings must match rows');
  return {
    sheetId,
    rows: rows.map((r, i) => ({ ...r, input: { ...r.input, reading: readings[i] }, observed: readings[i], decision: {} })),
  };
}

export function decide(s: ReviewState, binId: string, d: RowDecision): ReviewState {
  return { ...s, rows: s.rows.map((r) => (r.binId === binId ? { ...r, decision: d } : r)) };
}

/**
 * Badge mapping:
 *   resolved 'no-observation' -> Unchanged     resolved 'agreement' -> Agrees
 *   resolved 'applied'        -> Clean edit (clean-edit row, no explicit choice yet) | Applied (accept-paper)
 *   resolved 'kept-desk'      -> Kept desk     resolved 'deferred'  -> Deferred
 *   unresolved 'conflict'     -> Conflict      unresolved 'needs-reading' -> Check mark
 */
export function rowView(row: ReviewRowState): { resolution: Resolution; badge: Badge } {
  const resolution = resolveRow(row.input, row.decision);
  if (resolution.state === 'unresolved') {
    return { resolution, badge: resolution.cls === 'conflict' ? 'Conflict' : 'Check mark' };
  }
  switch (resolution.outcome) {
    case 'no-observation': return { resolution, badge: 'Unchanged' };
    case 'agreement': return { resolution, badge: 'Agrees' };
    case 'kept-desk': return { resolution, badge: 'Kept desk' };
    case 'deferred': return { resolution, badge: 'Deferred' };
    case 'applied':
      return { resolution, badge: resolution.cls === 'clean-edit' && !row.decision.choice ? 'Clean edit' : 'Applied' };
  }
}

export function canConfirm(s: ReviewState): boolean {
  return s.rows.every((r) => rowView(r).resolution.state === 'resolved');
}

/** Conflicts first, then unreadable marks, then the rest in sheet order. Uses the as-photographed class so cards do not jump while deciding. */
export function sortedRows(s: ReviewState): ReviewRowState[] {
  const rank = (r: ReviewRowState) => {
    const c = classify({ ...r.input, reading: r.observed });
    return c === 'conflict' ? 0 : c === 'needs-reading' ? 1 : 2;
  };
  return s.rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

export function toConfirmRequest(s: ReviewState): ConfirmRequest {
  return {
    sheetId: s.sheetId,
    rows: s.rows.map((r) => ({ binId: r.binId, deskRevSeen: r.input.deskRev, observed: r.observed, decision: r.decision })),
  };
}

export function refreshAfterStale(s: ReviewState, fresh: ReviewRow[], staleIds: string[]): ReviewState {
  return {
    ...s,
    rows: s.rows.map((r) => {
      if (!staleIds.includes(r.binId)) return r;
      const f = fresh.find((x) => x.binId === r.binId);
      if (!f) return r;
      return {
        ...r,
        input: { ...f.input, reading: r.observed },
        decision: {},
        staleNotice: `Desk changed to ${STATUS_LABEL[f.input.desk]} while you were reviewing`,
      };
    }),
  };
}

/** The photographed reading in plain words. */
export function readingWords(r: Reading): string {
  switch (r.kind) {
    case 'blank': return 'Blank (no observation)';
    case 'mark': return STATUS_LABEL[r.status];
    case 'double': return 'Two boxes marked';
    case 'uncertain': return 'Unclear mark';
  }
}

/** Horizontal centre of each status box (STATUSES order) as a fraction of the row crop's width. */
export function boxCenterFractions(): number[] {
  const { x, w } = rowRect(0);
  return BOX_XS.map((bx) => (bx + BOX_SIZE / 2 - x) / w);
}

/** True when an uploaded file is a downloaded FIXTURE photo (named fixture-<id>.png). */
export function isFixtureFileName(name: string): boolean {
  return name.startsWith('fixture-');
}
