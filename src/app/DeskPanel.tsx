import { useEffect, useState } from 'react';
import { STATUSES, STATUS_LABEL, type Bin, type Status } from '../domain/types';
import { useStore } from './StoreContext';

export function DeskPanel() {
  const { store, version, bump } = useStore();
  const [bins, setBins] = useState<Bin[]>([]);

  useEffect(() => {
    let live = true;
    store.listBins().then((b) => { if (live) setBins(b); });
    return () => { live = false; };
  }, [store, version]);

  const change = async (bin: Bin, status: Status) => {
    await store.setBinStatus(bin.id, status);
    bump();
  };

  return (
    <section aria-labelledby="desk-h">
      <h2 id="desk-h">Desk: the library's record</h2>
      <p className="lede">
        This is the live record of each bin. Edit a status here, for example when someone at the desk
        changes a bin while a stocktake sheet is out being marked by hand.
      </p>
      <table>
        <thead>
          <tr><th>Bin</th><th>Status</th><th>Rev</th><th>Last change by</th><th>Updated</th></tr>
        </thead>
        <tbody>
          {bins.map((b) => (
            <tr key={b.id}>
              <td>{b.label}</td>
              <td>
                <select
                  aria-label={`Status of ${b.label}`}
                  value={b.status}
                  onChange={(e) => change(b, e.target.value as Status)}
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </td>
              <td>{b.rev}</td>
              <td>{b.source}</td>
              <td>{new Date(b.updatedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
