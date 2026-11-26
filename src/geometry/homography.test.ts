import { applyH, homography, invertH, type Pt } from './homography';

const src: Pt[] = [[0, 0], [210, 0], [0, 297], [210, 297]];
const dst: Pt[] = [[30, 20], [900, 60], [10, 1100], [840, 1180]];

describe('homography', () => {
  it('maps the four source points onto the destinations within 1e-6', () => {
    const H = homography(src, dst);
    expect(H[8]).toBe(1);
    src.forEach((p, i) => {
      const q = applyH(H, p);
      expect(q[0]).toBeCloseTo(dst[i][0], 6);
      expect(q[1]).toBeCloseTo(dst[i][1], 6);
    });
  });

  it('invertH round-trips an interior point', () => {
    const H = homography(src, dst);
    const Hi = invertH(H);
    const p: Pt = [77.3, 141.9];
    const back = applyH(Hi, applyH(H, p));
    expect(back[0]).toBeCloseTo(p[0], 6);
    expect(back[1]).toBeCloseTo(p[1], 6);
  });

  it('throws on degenerate input', () => {
    expect(() => homography(src, [[0, 0], [0, 0], [0, 0], [0, 0]])).toThrow();
  });
});
