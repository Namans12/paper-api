export const STATUSES = ['ready', 'needs-inspection', 'unavailable'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  ready: 'Ready',
  'needs-inspection': 'Needs inspection',
  unavailable: 'Unavailable',
};

/** source: 'seed' | 'desk' | `sheet:${id}` */
export interface Bin { id: string; label: string; status: Status; rev: number; updatedAt: string; source: string }
export interface IssuedRow { binId: string; label: string; printedStatus: Status; printedRev: number }
export interface Sheet { id: string; layout: 'stocktake-v1'; issuedAt: string; rows: IssuedRow[] }
export type Reading =
  | { kind: 'blank' } | { kind: 'mark'; status: Status }
  | { kind: 'double'; statuses: Status[] } | { kind: 'uncertain' };
export type RowClass = 'no-observation' | 'agreement' | 'clean-edit' | 'conflict' | 'needs-reading';
export type Choice = 'accept-paper' | 'keep-desk' | 'defer';
/** reading = reviewer's correction; only 'blank' | 'mark' allowed */
export interface RowDecision { reading?: Reading; choice?: Choice }
export interface RowInput { printed: Status; printedRev: number; desk: Status; deskRev: number; reading: Reading }
export type Outcome = 'applied' | 'kept-desk' | 'agreement' | 'no-observation' | 'deferred';
export type Resolution =
  | { state: 'resolved'; cls: RowClass; outcome: Outcome; finalStatus: Status; write: boolean }
  | { state: 'unresolved'; cls: 'conflict' | 'needs-reading' };
export interface ReceiptRow { binId: string; label: string; printed: Status; deskAtReview: Status; deskRevAtReview: number; observed: Reading; corrected?: Reading; outcome: Outcome; finalStatus: Status }
export interface Receipt { sheetId: string; confirmedAt: string; rows: ReceiptRow[]; appliedCount: number }
