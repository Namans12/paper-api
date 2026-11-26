import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeskPanel } from './DeskPanel';
import { SheetsPanel } from './SheetsPanel';
import { PrintView } from './PrintView';
import { ImportContext, type PendingImport } from './ImportContext';
import { StoreProvider, useStore } from './StoreContext';
import { rgbaToCanvas } from './canvas';

type Tab = 'desk' | 'sheets' | 'import';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'desk', label: 'Desk' },
  { id: 'sheets', label: 'Sheets' },
  { id: 'import', label: 'Import' },
];

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

/** Task 6 replaces this placeholder with the real import, review and receipt flow. */
function ImportPlaceholder({ pending, receiptId }: { pending: PendingImport | null; receiptId?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host.current && pending) host.current.replaceChildren(rgbaToCanvas(pending.img));
    else host.current?.replaceChildren();
  }, [pending]);
  return (
    <section aria-labelledby="import-h">
      <h2 id="import-h">Import: read a marked sheet</h2>
      {receiptId && <p>Receipt for sheet <code>{receiptId}</code> is not available yet.</p>}
      {pending ? (
        <>
          <p>Pending image ({pending.source === 'fixture' ? 'FIXTURE, synthetic' : 'uploaded'}): review comes next.</p>
          <div ref={host} className="fixture-preview" />
        </>
      ) : (
        <p className="muted">No photo imported yet. Make a FIXTURE photo on the Sheets tab.</p>
      )}
    </section>
  );
}

function Shell() {
  const { store, bump } = useStore();
  const hash = useHash();
  const [tab, setTab] = useState<Tab>('desk');
  const [pending, setPending] = useState<PendingImport | null>(null);
  const counter = useRef(0);

  const startImport = useCallback((img: PendingImport['img'], source: PendingImport['source']) => {
    setPending({ img, source, key: ++counter.current });
    setTab('import');
  }, []);
  const importCtx = useMemo(() => ({ startImport }), [startImport]);

  const receiptId = /^#\/receipt\/(.+)$/.exec(hash)?.[1];
  const activeTab: Tab = receiptId ? 'import' : tab;

  const reset = async () => {
    if (!window.confirm('Reset clears all bins, sheets and receipts in this browser. Continue?')) return;
    await store.reset();
    setPending(null);
    bump();
  };

  return (
    <ImportContext.Provider value={importCtx}>
      <header className="app-head">
        <h1>Paper API</h1>
        <nav role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={activeTab === t.id}
              onClick={() => { if (receiptId) window.location.hash = ''; setTab(t.id); }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {activeTab === 'desk' && <DeskPanel />}
        {activeTab === 'sheets' && <SheetsPanel />}
        {activeTab === 'import' && <ImportPlaceholder pending={pending} receiptId={receiptId} />}
      </main>
      <footer className="app-foot">
        <span>Data lives only in this browser (IndexedDB ‘paper-api’). Reset clears bins, sheets and receipts.</span>
        <button type="button" onClick={reset}>Reset</button>
      </footer>
    </ImportContext.Provider>
  );
}

export function App() {
  const hash = useHash();
  const print = /^#\/print\/(.+)$/.exec(hash);
  return (
    <StoreProvider>
      {print ? <PrintView sheetId={decodeURIComponent(print[1])} /> : <Shell />}
    </StoreProvider>
  );
}
