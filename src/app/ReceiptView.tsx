import { STATUS_LABEL, type Outcome, type Receipt } from '../domain/types';
import { readingWords } from './review-model';

const OUTCOME_WORDS: Record<Outcome, string> = {
  applied: 'Applied',
  'kept-desk': 'Kept desk',
  deferred: 'Deferred for recheck',
  agreement: 'Agrees',
  'no-observation': 'No observation',
};

export function ReceiptView({ receipt, fixture, already }: { receipt: Receipt; fixture?: boolean; already?: boolean }) {
  return (
    <section aria-labelledby="receipt-h" className="receipt">
      <h2 id="receipt-h">
        Receipt {fixture && <span className="tag-fixture">FIXTURE</span>}
      </h2>
      {already && <p role="status" className="banner banner-info">Already applied — this is the original receipt.</p>}
      <p>Sheet <code>{receipt.sheetId}</code> · confirmed {new Date(receipt.confirmedAt).toLocaleString()} · <strong>{receipt.appliedCount}</strong> change{receipt.appliedCount === 1 ? '' : 's'} applied</p>
      <table>
        <thead>
          <tr><th>Bin</th><th>Printed</th><th>Desk at review</th><th>Paper</th><th>Outcome</th><th>Final</th></tr>
        </thead>
        <tbody>
          {receipt.rows.map((r) => (
            <tr key={r.binId}>
              <td>{r.label}</td>
              <td>{STATUS_LABEL[r.printed]}</td>
              <td>{STATUS_LABEL[r.deskAtReview]}</td>
              <td>
                {readingWords(r.observed)}
                {r.corrected && <> → corrected to {readingWords(r.corrected)}</>}
              </td>
              <td>{OUTCOME_WORDS[r.outcome]}</td>
              <td><strong>{STATUS_LABEL[r.finalStatus]}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
