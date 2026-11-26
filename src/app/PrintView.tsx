import { useEffect, useState } from 'react';
import type { Sheet } from '../domain/types';
import { SheetSvg } from '../sheet/SheetSvg';
import { useStore } from './StoreContext';

export function PrintView({ sheetId }: { sheetId: string }) {
  const { store } = useStore();
  const [sheet, setSheet] = useState<Sheet | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    store.getSheet(sheetId).then((s) => { if (live) setSheet(s ?? null); });
    return () => { live = false; };
  }, [store, sheetId]);

  if (sheet === undefined) return <p className="status-msg" role="status">Loading sheet…</p>;
  if (sheet === null) return <p className="status-msg">Sheet not found in this browser.</p>;
  return (
    <div className="print-view">
      <style>{'@page { size: A4; margin: 0 }'}</style>
      <div className="no-print print-bar">
        <button type="button" onClick={() => window.print()}>Print</button>
        <span>Print on A4 at 100% scale (on Letter paper, use “Fit to page”), on plain white paper.</span>
      </div>
      <SheetSvg sheet={sheet} />
    </div>
  );
}
