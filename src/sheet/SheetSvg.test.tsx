import { renderToStaticMarkup } from 'react-dom/server';
import { SheetSvg } from './SheetSvg';
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
});
