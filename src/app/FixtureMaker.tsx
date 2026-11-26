import { useEffect, useRef, useState } from 'react';
import { STATUSES, STATUS_LABEL, type Sheet, type Status } from '../domain/types';
import { renderSheetRaster, type FixtureMark, type RGBA } from '../sheet/raster';
import { defaultPhotoOptions, simulatePhoto } from '../sheet/simulate';
import { rgbaToCanvas, rgbaToPngBlob } from './canvas';
import { useImport } from './ImportContext';
import { LABEL_STRIP_PX, withLabelStrip } from './fixtureLabel';

type Choice = '' | Status | 'stray';
const FIXTURE_LABEL = 'FIXTURE — synthetic photo';
const OPTIONS: Array<{ value: Choice; label: string }> = [
  { value: '', label: 'Blank' },
  { value: 'ready', label: 'Ready' },
  { value: 'needs-inspection', label: 'Needs' },
  { value: 'unavailable', label: 'Unavail.' },
  { value: 'stray', label: 'Stray' },
];

function defaults(sheet: Sheet): Choice[] {
  // Bin-4 scenario: bin 2 Unavailable, bin 4 Needs inspection, bin 5 Unavailable.
  const d: Choice[] = sheet.rows.map(() => '');
  d[1] = 'unavailable';
  d[3] = 'needs-inspection';
  d[4] = 'unavailable';
  return d;
}

function toMarks(choices: Choice[]): FixtureMark[] {
  const marks: FixtureMark[] = [];
  choices.forEach((c, row) => {
    if (c === '') return;
    if (c === 'stray') marks.push({ row, col: 1, kind: 'stray' });
    else marks.push({ row, col: STATUSES.indexOf(c), kind: 'x' });
  });
  return marks;
}

export function FixtureMaker({ sheet, onClose }: { sheet: Sheet; onClose(): void }) {
  const { startImport } = useImport();
  const [choices, setChoices] = useState<Choice[]>(() => defaults(sheet));
  const [photo, setPhoto] = useState<RGBA | null>(null);
  const [working, setWorking] = useState(false);
  const preview = useRef<HTMLDivElement>(null);

  const generate = () => {
    setWorking(true);
    // Let the "Rendering…" state paint before the synchronous raster work.
    setTimeout(() => {
      const page = renderSheetRaster(sheet, toMarks(choices), 4);
      const sim = withLabelStrip(simulatePhoto(page, defaultPhotoOptions(Date.now() >>> 0)));
      const canvas = rgbaToCanvas(sim);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(FIXTURE_LABEL, 16, Math.round(LABEL_STRIP_PX * 0.7));
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setPhoto({ width: canvas.width, height: canvas.height, data });
      setWorking(false);
    }, 20);
  };

  useEffect(() => {
    const host = preview.current;
    if (!host || !photo) return;
    const canvas = rgbaToCanvas(photo);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'FIXTURE synthetic photo of the marked sheet');
    host.replaceChildren(canvas);
  }, [photo]);

  const download = async () => {
    if (!photo) return;
    const url = URL.createObjectURL(await rgbaToPngBlob(photo));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fixture-${sheet.id}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); // Safari cancels the download if revoked immediately
  };

  return (
    <div className="fixture" role="group" aria-labelledby={`fx-${sheet.id}`}>
      <div className="fixture-head">
        <h3 id={`fx-${sheet.id}`}>FIXTURE photo for sheet <code>{sheet.id}</code></h3>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <p className="lede">
        Pretend a volunteer marked the sheet. Choose the mark for each bin, then generate a synthetic
        photo. It is labelled FIXTURE and is not a real photograph.
      </p>
      <table>
        <thead>
          <tr><th>Bin</th>{OPTIONS.map((o) => <th key={o.label}>{o.label}</th>)}</tr>
        </thead>
        <tbody>
          {sheet.rows.map((row, r) => (
            <tr key={row.binId}>
              <th scope="row">{row.label}</th>
              {OPTIONS.map((o) => (
                <td key={o.label}>
                  <input
                    type="radio"
                    name={`mark-${r}`}
                    aria-label={`${row.label}: ${o.value === '' ? 'blank' : o.value === 'stray' ? 'stray mark' : STATUS_LABEL[o.value]}`}
                    checked={choices[r] === o.value}
                    onChange={() => setChoices((c) => c.map((v, i) => (i === r ? o.value : v)))}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button type="button" onClick={generate} disabled={working}>
          {working ? 'Rendering…' : photo ? 'Regenerate photo' : 'Generate photo'}
        </button>
        <button type="button" onClick={download} disabled={!photo}>Download PNG</button>
        <button type="button" onClick={() => photo && startImport(photo, 'fixture')} disabled={!photo}>
          Import this photo
        </button>
      </div>
      <div ref={preview} className="fixture-preview" />
    </div>
  );
}
