import { renderToStaticMarkup } from 'react-dom/server';
import { SheetSvg } from './SheetSvg';
import { BOX_SIZE, BOX_XS, boxRect, FIDUCIAL_ORIGINS, QR_BOX } from './layout';
import { encodePayload, qrMatrix } from './qr';
import type { Sheet } from '../domain/types';

const sheet: Sheet = {
  id: 'abcdefghjk',
  layout: 'stocktake-v1',
  issuedAt: '2026-01-01T00:00:00.000Z',
  rows: [
    { binId: 'b1', label: 'Bin 1 · Ladder', printedStatus: 'ready', printedRev: 1 },
    { binId: 'b4', label: 'Bin 4 · Pressure washer', printedStatus: 'ready', printedRev: 1 },
  ],
};

describe('SheetSvg', () => {
  const html = renderToStaticMarkup(<SheetSvg sheet={sheet} />);
  it('is A4 in millimetres', () => {
    expect(html).toContain('width="210mm"');
    expect(html).toContain('viewBox="0 0 210 297"');
  });
  it('draws exactly four 12mm fiducials', () => {
    const f = html.match(/<rect[^>]*data-role="fiducial"[^>]*>/g) ?? [];
    expect(f).toHaveLength(4);
    for (const r of f) {
      expect(r).toContain('width="12"');
      expect(r).toContain('height="12"');
    }
  });
  it('prints row text and sheet id', () => {
    expect(html).toContain('Bin 4 · Pressure washer');
    expect(html).toContain('Now: Ready');
    expect(html).toContain('abcdefghjk');
  });
  it('renders the QR as a single path', () => {
    expect((html.match(/<path/g) ?? []).length).toBe(1);
  });

  const attr = (tag: string, name: string) => Number(new RegExp(`\\s${name}="([^"]+)"`).exec(tag)![1]);
  it('places fiducials at FIDUCIAL_ORIGINS', () => {
    const f = html.match(/<rect[^>]*data-role="fiducial"[^>]*>/g)!;
    expect(f.map((t) => [attr(t, 'x'), attr(t, 'y')])).toEqual(FIDUCIAL_ORIGINS);
  });
  it('draws checkbox outlines whose outer edge equals boxRect', () => {
    const boxes = html.match(/<rect[^>]*data-role="checkbox"[^>]*>/g)!;
    expect(boxes).toHaveLength(18);
    boxes.forEach((t, i) => {
      const b = boxRect(Math.floor(i / BOX_XS.length), i % BOX_XS.length);
      const sw = attr(t, 'stroke-width');
      expect(sw).toBe(0.6);
      expect(attr(t, 'x') - sw / 2).toBeCloseTo(b.x, 6);
      expect(attr(t, 'y') - sw / 2).toBeCloseTo(b.y, 6);
      expect(attr(t, 'width') + sw).toBeCloseTo(BOX_SIZE, 6);
      expect(attr(t, 'height') + sw).toBeCloseTo(BOX_SIZE, 6);
    });
  });
  it('starts the QR symbol after the 4-module quiet zone', () => {
    const m = QR_BOX.w / (qrMatrix(encodePayload(sheet.id)).size + 8);
    const d = /<path[^>]*\sd="([^"]+)"/.exec(html)![1];
    const first = /^M([\d.]+) ([\d.]+)/.exec(d)!;
    expect(Math.abs(Number(first[1]) - (QR_BOX.x + 4 * m))).toBeLessThan(1e-3);
    expect(Math.abs(Number(first[2]) - (QR_BOX.y + 4 * m))).toBeLessThan(1e-3);
  });
});
