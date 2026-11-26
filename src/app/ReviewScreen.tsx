import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUSES, STATUS_LABEL, type Receipt, type Reading } from '../domain/types';
import type { ReviewRow } from '../store/db';
import type { RGBA } from '../sheet/raster';
import { renderCrop } from '../reader/read';
import { rowRect } from '../sheet/layout';
import { rgbaToCanvas } from './canvas';
import { useStore } from './StoreContext';
import {
  boxCenterFractions, canConfirm, decide, initReview, readingWords, refreshAfterStale, rowView, sortedRows, toConfirmRequest,
  type ReviewRowState, type ReviewState,
} from './review-model';

export interface ReviewInput {
  sheetId: string;
  rows: ReviewRow[];
  readings: Reading[];
  image: RGBA;
  H: number[];
  fixture: boolean;
}

const SHORT: Record<string, string> = { ready: 'Ready', 'needs-inspection': 'Needs', unavailable: 'Unavail.' };

function Crop({ canvas, label }: { canvas: HTMLCanvasElement; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current?.replaceChildren(canvas);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
  }, [canvas, label]);
  const centers = boxCenterFractions();
  return (
    <div className="crop">
      <div className="crop-cols" aria-hidden="true">
        {STATUSES.map((st, i) => (
          <span key={st} title={STATUS_LABEL[st]} style={{ left: `${centers[i] * 100}%` }}>{SHORT[st]}</span>
        ))}
      </div>
      <div ref={host} />
    </div>
  );
}

const BADGE_CLASS: Record<string, string> = {
  Conflict: 'badge-danger', 'Check mark': 'badge-warn', 'Clean edit': 'badge-info', Applied: 'badge-info',
};

function Card({ row, crop, fixture, busy, onDecide }: { row: ReviewRowState; crop: HTMLCanvasElement; fixture: boolean; busy: boolean; onDecide: (d: ReviewRowState['decision']) => void }) {
  const { resolution, badge } = rowView(row);
  const { decision, observed, input } = row;
  const needsReadingRow = observed.kind === 'double' || observed.kind === 'uncertain';
  const cls = resolution.cls;
  const choiceBtn = (choice: 'keep-desk' | 'accept-paper' | 'defer', text: string, pressed: boolean) => (
    <button type="button" disabled={busy} aria-pressed={pressed} onClick={() => onDecide({ ...decision, choice })}>{text}</button>
  );
  const readsAs = (r: Reading, text: string) => {
    const pressed = decision.reading?.kind === r.kind && (r.kind !== 'mark' || (decision.reading.kind === 'mark' && decision.reading.status === r.status));
    return <button key={text} type="button" disabled={busy} aria-pressed={pressed} onClick={() => onDecide({ reading: r })}>{text}</button>;
  };
  return (
    <article className={`review-card cls-${cls}`} aria-label={row.label}>
      <h3>{row.label} <span className={`badge ${BADGE_CLASS[badge] ?? ''}`}>{badge}</span></h3>
      {row.staleNotice && <p role="alert" className="banner banner-warn">{row.staleNotice}</p>}
      <div className="card-body">
        <Crop canvas={crop} label={`${fixture ? 'FIXTURE photo' : 'Photo'} of ${row.label} row`} />
        <dl className="values">
          <div><dt>Printed</dt><dd>{STATUS_LABEL[input.printed]}</dd></div>
          <div><dt>Desk now</dt><dd>{STATUS_LABEL[input.desk]}</dd></div>
          <div><dt>Paper</dt><dd>{readingWords(observed)}{decision.reading && <> → you set: {readingWords(decision.reading)}</>}</dd></div>
        </dl>
      </div>
      {cls === 'conflict' && <p className="explain">The desk changed this bin after the sheet was printed, and the paper disagrees.</p>}
      <div className="actions" role="group" aria-label={`Decision for ${row.label}`}>
        {needsReadingRow && (
          <>
            {STATUSES.map((s) => readsAs({ kind: 'mark', status: s }, `Reads as ${STATUS_LABEL[s]}`))}
            {readsAs({ kind: 'blank' }, 'Reads as Blank')}
          </>
        )}
        {cls === 'conflict' && (
          <>
            {choiceBtn('keep-desk', 'Keep desk', decision.choice === 'keep-desk')}
            {choiceBtn('accept-paper', 'Accept paper', decision.choice === 'accept-paper')}
          </>
        )}
        {cls === 'clean-edit' && (
          <>
            {choiceBtn('accept-paper', 'Accept', decision.choice === undefined || decision.choice === 'accept-paper')}
            {choiceBtn('keep-desk', 'Keep desk', decision.choice === 'keep-desk')}
          </>
        )}
        {(cls === 'conflict' || cls === 'clean-edit' || cls === 'needs-reading') &&
          choiceBtn('defer', 'Defer for recheck', decision.choice === 'defer')}
      </div>
    </article>
  );
}

export function ReviewScreen({ input, onReceipt }: { input: ReviewInput; onReceipt: (r: Receipt, already: boolean) => void }) {
  const { store, bump } = useStore();
  const [state, setState] = useState<ReviewState>(() => initReview(input.sheetId, input.rows, input.readings));
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const crops = useMemo(() => {
    const m = new Map<string, HTMLCanvasElement>();
    input.rows.forEach((r, i) => m.set(r.binId, rgbaToCanvas(renderCrop(input.image, input.H, rowRect(i)))));
    return m;
  }, [input]);

  const ordered = sortedRows(state);
  const needDecision = state.rows.filter((r) => rowView(r).resolution.state === 'unresolved').length;
  const ok = canConfirm(state);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await store.confirm(toConfirmRequest(state));
      switch (res.kind) {
        case 'committed': bump(); onReceipt(res.receipt, false); break;
        case 'already': onReceipt(res.receipt, true); break;
        case 'stale': {
          const p = await store.prepareReview(state.sheetId, state.rows.map((r) => r.observed));
          if (p.kind === 'receipt') { onReceipt(p.receipt, true); break; }
          if (p.kind !== 'review') { setError('This sheet is no longer available. No changes made.'); break; }
          setState((s) => refreshAfterStale(s, p.rows, res.binIds));
          const names = res.binIds.map((id) => state.rows.find((r) => r.binId === id)?.label ?? id);
          setBanner(`The desk changed while you were reviewing: ${names.join(', ')}. Review ${res.binIds.length === 1 ? 'it' : 'them'} again. No changes made.`);
          break;
        }
        case 'unresolved': {
          const names = res.binIds.map((id) => state.rows.find((r) => r.binId === id)?.label ?? id);
          setError(`Still needs a decision: ${names.join(', ')}. No changes made.`);
          break;
        }
        case 'unknown-sheet':
        case 'mismatch':
          setError('This sheet could not be confirmed here. No changes made.');
          break;
      }
    } catch (e) {
      setError(`Could not apply: ${e instanceof Error ? e.message : String(e)}. No changes made.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="review-h">
      <h2 id="review-h">
        Review sheet <code>{input.sheetId}</code> {input.fixture && <span className="tag-fixture">FIXTURE</span>}
      </h2>
      {banner && <p role="alert" className="banner banner-warn">{banner}</p>}
      {error && <p role="alert" className="banner banner-danger">{error}</p>}
      <div className="review-list">
        {ordered.map((r) => (
          <Card key={r.binId} row={r} crop={crops.get(r.binId)!} fixture={input.fixture} busy={busy} onDecide={(d) => { setBanner(null); setState((s) => decide(s, r.binId, d)); }} />
        ))}
      </div>
      <div className="confirm-bar">
        <span aria-live="polite">{ok ? 'All rows reviewed.' : `${needDecision} need${needDecision === 1 ? 's' : ''} your decision`}</span>
        <button type="button" className="primary" disabled={!ok || busy} onClick={confirm}>Apply reviewed changes</button>
      </div>
    </section>
  );
}
