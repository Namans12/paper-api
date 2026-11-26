import { affineFit, applyH, homography, invertH, type Pt } from './homography';

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

  it('throws on duplicate or three-collinear points', () => {
    expect(() => homography(src, [[0, 0], [100, 0], [200, 0], [50, 50]])).toThrow();
    expect(() => homography(src, [[1, 1], [1, 1], [500, 2], [3, 900]])).toThrow();
    expect(() => homography([[0, 0], [1, 1], [2, 2], [5, 0]], dst)).toThrow();
  });

  it('accepts strong perspective and rotated corner permutations', () => {
    const skew: Pt[] = [[120, 80], [1100, 200], [20, 1500], [1000, 1590]];
    const perms = [[0, 1, 2, 3], [2, 0, 3, 1], [3, 2, 1, 0], [1, 3, 0, 2]];
    for (const p of perms) {
      const d = p.map((i) => skew[i]);
      const H = homography(src, d);
      applyH(H, [105, 148]).forEach((v) => expect(Number.isFinite(v)).toBe(true));
    }
  });
});

describe('affineFit', () => {
  const src: Pt[] = [[0, 0], [20, 0], [20, 20], [0, 20]];
  it('recovers an exact affine map', () => {
    const f = (p: Pt): Pt => [2 * p[0] + 0.5 * p[1] + 7, -0.3 * p[0] + 1.5 * p[1] - 4];
    const A = affineFit(src, src.map(f));
    for (const p of [[0, 0], [100, 250], [-30, 40]] as Pt[]) {
      const q = applyH(A, p), e = f(p);
      expect(q[0]).toBeCloseTo(e[0], 6);
      expect(q[1]).toBeCloseTo(e[1], 6);
    }
  });
  it('is a least-squares fit when the points are not exactly affine', () => {
    const A = affineFit(src, [[0, 0], [20, 0], [20.4, 20], [0, 20]]);
    const q = applyH(A, [10, 10]);
    expect(q[0]).toBeCloseTo(10.1, 6);
    expect(q[1]).toBeCloseTo(10, 6);
    expect(A.slice(6)).toEqual([0, 0, 1]);
  });
  it('rejects collinear sources', () => {
    expect(() => affineFit([[0, 0], [1, 1], [2, 2], [3, 3]], src)).toThrow();
  });
});
