# Paper API

A stocktake desk keeps bin statuses on a screen, but the people counting stock work with paper. When their sheet disagrees with the desk, nobody knows which is right. Paper API prints a stocktake sheet tied to the record exactly as printed, reads a phone photo of the marked sheet, and shows every desk-versus-paper conflict beside a crop of the actual ink. A person reviews the batch and applies it in one step with a receipt. Example: bin 4 was printed as Ready, someone at the desk then set it to Unavailable, and the paper says Needs inspection. Paper API shows all three and lets you choose, rather than silently overwriting.

## Quick start

```
npm install
npm run dev
```

Open the address that `npm run dev` prints. Requires Node 22. Everything runs in your browser.

## Bin 4 walkthrough

1. Click **Reset** in the footer.
2. Open **Sheets** and press **Issue new sheet**.
3. Open **Desk** and set Bin 4 (Pressure washer) to **Unavailable**.
4. Open **Sheets** and press **Make FIXTURE photo**. The defaults mark bin 2 Unavailable, bin 4 Needs inspection and bin 5 Unavailable.
5. Press **Generate photo**, then **Import this photo**.
6. Bin 4 shows **Conflict**: Printed Ready, Desk now Unavailable, Paper Needs inspection. Bin 2 is a **Clean edit** and bin 5 **Agrees**.
7. Optional: in a second tab change bin 2 at the Desk, then press Apply in the first tab. You get "The desk changed while you were reviewing" and bin 2 needs review again.
8. Choose **Keep desk** on bin 4, then press **Apply reviewed changes**. A receipt is shown.
9. Import the same PNG again with the file picker on the Import tab. You get "Already applied — this is the original receipt."

## How it works

1. **Issue** a sheet: the app records each bin's status and revision as printed.
2. **Print** it on A4 at 100%.
3. **Mark** with an X in a box per row.
4. **Photo**: take a phone picture of the whole page.
5. **Read**: the QR code gives the sheet identity, the four black corner squares give alignment, and each box is measured for ink, with a per-box alignment check.
6. **Review**: each row shows Printed, Desk now and Paper beside the photo crop. Choose Keep desk, Accept paper or Defer for recheck.
7. **Confirm**: all chosen changes are applied in one transaction, with one receipt per sheet.

## Safety rules

- An unclear mark (tiny tick, two boxes, smudge) is never offered as a clean edit. It needs a person to look.
- If the photo cannot be identified or aligned, it is rejected instead of guessed at.
- If the desk changed while you were reviewing, the affected rows go back to review.
- Each sheet produces one receipt. Importing an applied sheet again shows the original receipt and changes nothing.

## Where data lives

Bins, issued sheets and receipts are stored only in this browser (IndexedDB database `paper-api`). Nothing is sent anywhere: no accounts, no analytics, no network calls. **Reset** clears bins, sheets and receipts.

## FIXTURE photos are not real photographs

The photos made by **Make FIXTURE photo** are synthetic, labelled FIXTURE, and exist so the app can be tried without a printer. They are not real photographs. Accuracy on real phone photos is measured separately with `npm run capture-test`, following [docs/capture-test.md](docs/capture-test.md).

## Testing

```
npm test
npm run typecheck
npm run capture-test
```

`capture-test` reads real photos from `captures/` against your `captures/answers.json`. It needs your own photos, so it is not part of `npm test`. Pass bar: at least 8 of 10 passing and zero incorrect.

## Status and limitations

- One sheet layout, six bins, X marks only.
- Single browser: no accounts, no sync, no multi-user.
- The real-photo capture test is pending; real-photo accuracy is not yet known.

## Licence

MIT. See [LICENSE](LICENSE).
