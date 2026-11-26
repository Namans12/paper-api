import { useEffect, useRef, useState } from 'react';
import type { Receipt } from '../domain/types';
import { readSheet, type ReadFailure } from '../reader/read';
import { fileToRGBA } from './canvas';
import type { PendingImport } from './ImportContext';
import { isFixtureFileName } from './review-model';
import { ReceiptView } from './ReceiptView';
import { ReviewScreen, type ReviewInput } from './ReviewScreen';
import { useStore } from './StoreContext';
import type { RGBA } from '../sheet/raster';

const FAIL_COPY: Record<ReadFailure, string> = {
  'no-qr': 'Couldn’t find the sheet’s QR code — retake with the whole page in frame.',
  'bad-payload': 'This QR code isn’t from a Paper API stocktake sheet.',
  'no-alignment': 'Couldn’t find all four corner squares — retake with the whole page in frame.',
  'alignment-mismatch': 'The sheet looks bent or partly hidden — flatten it and retake the photo.',
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'failed'; message: string }
  | { kind: 'review'; input: ReviewInput; key: number }
  | { kind: 'receipt'; receipt: Receipt; already: boolean; fixture: boolean };

export function ReceiptRoute({ sheetId }: { sheetId: string }) {
  const { store } = useStore();
  const [receipt, setReceipt] = useState<Receipt | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setReceipt(undefined);
    store.getReceipt(sheetId).then((r) => { if (live) setReceipt(r ?? null); });
    return () => { live = false; };
  }, [store, sheetId]);
  if (receipt === undefined) return <p role="status">Loading receipt…</p>;
  if (receipt === null) return <p role="alert" className="banner banner-danger">No receipt for this sheet in this browser.</p>;
  return <ReceiptView receipt={receipt} />;
}

export function ImportPanel({ pending, receiptId }: { pending: PendingImport | null; receiptId?: string }) {
  const { store } = useStore();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const token = useRef(0);
  const seen = useRef<number | null>(null);

  const run = async (img: RGBA, fixture: boolean) => {
    const mine = ++token.current;
    const current = () => mine === token.current;
    setPhase({ kind: 'reading' });
    try {
      await new Promise((r) => setTimeout(r, 30)); // let "Reading photo…" paint before the synchronous read
      const result = readSheet(img);
      if (!current()) return;
      if (!result.ok) { setPhase({ kind: 'failed', message: `${FAIL_COPY[result.reason]} No changes made.` }); return; }
      const readings = result.rows.map((r) => r.reading);
      const prep = await store.prepareReview(result.sheetId, readings);
      if (!current()) return;
      if (prep.kind === 'unknown-sheet') {
        setPhase({ kind: 'failed', message: 'This sheet wasn’t issued from this browser (or was reset). No changes made.' });
      } else if (prep.kind === 'receipt') {
        setPhase({ kind: 'receipt', receipt: prep.receipt, already: true, fixture });
      } else {
        setPhase({
          kind: 'review',
          key: mine,
          input: { sheetId: result.sheetId, rows: prep.rows, readings, image: result.image, H: result.H, fixture },
        });
      }
    } catch (e) {
      if (current()) setPhase({ kind: 'failed', message: `Couldn’t read this photo (${e instanceof Error ? e.message : String(e)}). No changes made.` });
    }
  };

  useEffect(() => {
    if (!pending || seen.current === pending.key) return;
    seen.current = pending.key;
    void run(pending.img, pending.source === 'fixture');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const mine = ++token.current;
    setPhase({ kind: 'reading' });
    try {
      const img = await fileToRGBA(file);
      if (mine !== token.current) return;
      await run(img, isFixtureFileName(file.name));
    } catch {
      token.current++;
      setPhase({ kind: 'failed', message: 'Couldn’t open that file as an image. No changes made.' });
    }
  };

  return (
    <>
    {receiptId && <ReceiptRoute sheetId={decodeURIComponent(receiptId)} />}
    <section aria-labelledby="import-h" hidden={!!receiptId}>
      <h2 id="import-h">Import: read a marked sheet</h2>
      <p>
        <label>
          Photo of a marked sheet{' '}
          <input type="file" accept="image/*" capture="environment" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </p>
      {phase.kind === 'idle' && <p className="muted">No photo imported yet. Choose a photo, or make a FIXTURE photo on the Sheets tab.</p>}
      {phase.kind === 'reading' && <p role="status">Reading photo…</p>}
      {phase.kind === 'failed' && <p role="alert" className="banner banner-danger">{phase.message}</p>}
      {phase.kind === 'review' && (
        <ReviewScreen
          key={phase.key}
          input={phase.input}
          onReceipt={(receipt, already) => setPhase({ kind: 'receipt', receipt, already, fixture: phase.input.fixture })}
        />
      )}
      {phase.kind === 'receipt' && <ReceiptView receipt={phase.receipt} already={phase.already} fixture={phase.fixture} />}
    </section>
    </>
  );
}
