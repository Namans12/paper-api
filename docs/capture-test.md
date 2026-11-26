# Real-photo capture test (go/no-go)

This test shows whether Paper API can read real phone photos of real marked sheets. Everything built so far was tested on synthetic FIXTURE photos only. You need about an hour, a printer, a pen and a phone.

**Pass bar: at least 8 of 10 photos passing, and zero incorrect.** If it fails, we change plan, so please follow the steps exactly and do not tidy up the photos.

## 1. Print two sheets

1. Run `npm run dev` and open the printed address in your browser.
2. Open the **Sheets** tab and press **Issue new sheet** twice.
3. For each sheet, write down the sheet ID shown in the list. It is 10 letters and digits.
4. Press **Print** on each sheet in the list. This opens a print view in a new tab; press **Print** again there. Print on A4 or Letter at **100% scale**. Do not choose "fit to page" or "shrink to fit". Use a plain printer, black ink, white paper.

## 2. Fill in answers.json BEFORE you mark

1. Copy `captures/answers.example.json` to `captures/answers.json`.
2. Write one entry per photo you will take (10 in total, 5 per sheet is fine). Each entry has:
   - `file`: the photo's file name, for example `sheet1-daylight-1.jpg`
   - `sheetId`: the ID of the sheet in that photo
   - `rows`: exactly six values, bins 1 to 6 in order, one of:
     - `blank` : you made no mark on that row
     - `ready`, `needs-inspection`, `unavailable` : the box you marked
     - `ambiguous` : the row you deliberately made unclear (see below)
3. Decide the answers first, then mark the paper to match. Do not edit the answers after seeing the result.

## 3. Mark the sheets

- Use a dark ballpoint or felt-tip pen. Draw an **X that fills most of the box**, corner to corner.
- Mark one status per row at most. Leave one or two rows blank.
- On each sheet, make **one row deliberately ambiguous**: either a tiny tick in a corner of a box, or an X in two boxes of the same row. Write `ambiguous` for that row.
- You may mark the same sheet differently for different photos (use a new printout, or take all photos of one marking). Whatever is on the page when you take the photo must match that photo's entry.

## 4. Take the photos

Take **10 photos** in total:

- 5 in daylight and 5 under indoor light.
- Hold the phone slightly off-angle, not perfectly flat above the page.
- Use both phone orientations (portrait and landscape) across the set.
- Do not crop. The **whole page must be in frame, including all four black corner squares**.
- Avoid glare, and avoid shadows falling over the corner squares.
- No flash.

## 5. Export as JPEG, not HEIC

The test reads JPEG and PNG files. HEIC will not work.

- iPhone: Settings, Camera, Formats, choose **Most Compatible**, then take the photos. Android: photos are already JPEG.
- Android: photos are normally JPEG already.

Copy the photos into the `captures/` folder and name them exactly as in `answers.json`. The photos stay on your computer: they are ignored by git and are never committed.

## 6. Run it

```
npm run capture-test
```

## 7. Read the result

Each photo gets one label, followed by a line per bin showing what you wrote and what the reader saw:

| Label | Meaning |
| --- | --- |
| PASSING | Sheet identified and aligned, every clear row read correctly, every ambiguous row reported as unclear. |
| FLAGGED | Aligned, but a row you made clearly (or left blank) was reported as unclear, or an ambiguous row was read as blank. Safe, but not a pass. |
| REJECTED | The reader refused the photo (the reason is printed). Safe, but not a pass. |
| INCORRECT | The reader confidently said something wrong, such as the wrong status, a blank row read as marked, a marked row read as blank, an ambiguous row read as a mark, or the wrong sheet. This is the failure we cannot accept. |

The last lines say `RESULT: PASS` or `RESULT: FAIL`. It passes only with at least 8 passing out of 10 and zero incorrect. If you have fewer than 10 photos it says "Need 10 photos; have N" and still needs at least 8 passing.

## 8. If it fails

Send the results back either way. A failure is useful information. The planned fallback is to make the boxes and rows larger (4 rows), which is a developer change; then retry **once** with fresh photos. Do not retry more than once, and do not drop bad photos from the set.

## 9. What to send back

1. The full table printed by `npm run capture-test` (copy the whole output).
2. The 10 photos from `captures/`.
3. Your `captures/answers.json`.
