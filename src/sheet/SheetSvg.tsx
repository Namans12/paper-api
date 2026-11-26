import type { Sheet } from '../domain/types';
import { STATUSES, STATUS_LABEL } from '../domain/types';
import {
  BOX_XS, boxRect, FIDUCIAL_ORIGINS, FIDUCIAL_SIZE, PAGE, QR_BOX, ROW_COUNT, ROW_HEIGHT, ROW_TOP,
} from './layout';
import { encodePayload, qrMatrix } from './qr';

const STROKE = 0.6;
const FONT = 'Helvetica, Arial, sans-serif';

function qrPath(sheetId: string): string {
  const qr = qrMatrix(encodePayload(sheetId));
  const mod = QR_BOX.w / (qr.size + 8);
  const parts: string[] = [];
  for (let r = 0; r < qr.size; r++)
    for (let c = 0; c < qr.size; c++)
      if (qr.get(r, c)) {
        const x = +(QR_BOX.x + (4 + c) * mod).toFixed(4);
        const y = +(QR_BOX.y + (4 + r) * mod).toFixed(4);
        const m = +mod.toFixed(4);
        parts.push(`M${x} ${y}h${m}v${m}h${-m}z`);
      }
  return parts.join('');
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** A4 stocktake sheet. SVG user units are millimetres and match the raster geometry. */
export function SheetSvg({ sheet }: { sheet: Sheet }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="210mm"
      height="297mm"
      viewBox={`0 0 ${PAGE.w} ${PAGE.h}`}
      fontFamily={FONT}
      role="img"
      aria-label={`Stocktake sheet ${sheet.id}`}
    >
      <rect x={0} y={0} width={PAGE.w} height={PAGE.h} fill="#fff" />
      {FIDUCIAL_ORIGINS.map(([x, y], i) => (
        <rect key={i} data-role="fiducial" x={x} y={y} width={FIDUCIAL_SIZE} height={FIDUCIAL_SIZE} fill="#000" />
      ))}

      <text x={26} y={36} fontSize={7} fontWeight="bold" fill="#000">Equipment stocktake</text>
      <text x={26} y={44} fontSize={3.6} fill="#000">Sheet ID: {sheet.id}</text>
      <text x={26} y={50} fontSize={3.2} fill="#000">Issued {sheet.issuedAt.slice(0, 10)}</text>
      <path d={qrPath(sheet.id)} fill="#000" />

      <text x={20} y={85} fontSize={3.2} fill="#000">
        Mark ONE box per bin with a dark X. Leave a row blank if you did not check that bin.
      </text>

      {BOX_XS.map((bx, i) => (
        <text key={i} x={bx + 6} y={ROW_TOP - 8} fontSize={3} textAnchor="middle" fontWeight="bold" fill="#000">
          {STATUS_LABEL[STATUSES[i]]}
        </text>
      ))}

      {sheet.rows.slice(0, ROW_COUNT).map((row, r) => {
        const cy = ROW_TOP + r * ROW_HEIGHT + ROW_HEIGHT / 2;
        return (
          <g key={row.binId}>
            <text x={20} y={cy - 1} fontSize={4.2} fontWeight="bold" fill="#000">{clip(row.label, 34)}</text>
            <text x={20} y={cy + 5} fontSize={3.4} fill="#000">
              Now: {STATUS_LABEL[row.printedStatus]} · rev {row.printedRev}
            </text>
          </g>
        );
      })}

      {Array.from({ length: ROW_COUNT }, (_, r) =>
        BOX_XS.map((_bx, c) => {
          const b = boxRect(r, c);
          return (
            <rect
              key={`${r}-${c}`}
              x={b.x + STROKE / 2}
              y={b.y + STROKE / 2}
              width={b.w - STROKE}
              height={b.h - STROKE}
              fill="none"
              stroke="#000"
              strokeWidth={STROKE}
            />
          );
        }),
      )}
    </svg>
  );
}
