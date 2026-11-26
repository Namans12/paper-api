import { useEffect, useState } from 'react';
import type { Receipt, Sheet } from '../domain/types';
import { useStore } from './StoreContext';
import { FixtureMaker } from './FixtureMaker';

export function SheetsPanel() {
  const { store, version, bump } = useStore();
  const [rows, setRows] = useState<Array<{ sheet: Sheet; receipt?: Receipt }>>([]);
  const [makingFor, setMakingFor] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    store.listSheets().then((r) => {
      if (!live) return;
      setRows(r);
      setMakingFor((cur) => (cur && r.some((x) => x.sheet.id === cur.id) ? cur : null));
    });
    return () => { live = false; };
  }, [store, version]);

  const issue = async () => {
    setBusy(true);
    try { await store.issueSheet(); bump(); } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="sheets-h">
      <h2 id="sheets-h">Sheets: paper stocktakes</h2>
      <p className="lede">
        Issue a sheet to print. It records what each bin looked like at that moment. Mark it by hand,
        photograph it, then import the photo. No camera handy? Make a FIXTURE photo to try the flow.
      </p>
      <button type="button" onClick={issue} disabled={busy}>Issue new sheet</button>
      {rows.length === 0 ? (
        <p className="muted">No sheets issued yet.</p>
      ) : (
        <table>
          <thead><tr><th>Sheet ID</th><th>Issued</th><th>State</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map(({ sheet, receipt }) => (
              <tr key={sheet.id}>
                <td><code>{sheet.id}</code></td>
                <td>{new Date(sheet.issuedAt).toLocaleString()}</td>
                <td>{receipt ? <a href={`#/receipt/${sheet.id}`}>Confirmed (receipt)</a> : 'Open'}</td>
                <td className="actions">
                  <button type="button" onClick={() => window.open(`#/print/${sheet.id}`, '_blank')}>Print</button>
                  <button type="button" onClick={() => setMakingFor(sheet)}>Make FIXTURE photo</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {makingFor && <FixtureMaker key={makingFor.id} sheet={makingFor} onClose={() => setMakingFor(null)} />}
    </section>
  );
}
