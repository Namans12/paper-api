export type Pt = [number, number];

/** Solves the 8x8 DLT system (Gaussian elimination, partial pivoting). Row-major 3x3 with H[8] = 1. */
export function homography(src: Pt[], dst: Pt[]): number[] {
  if (src.length !== 4 || dst.length !== 4) throw new Error('homography needs exactly 4 point pairs');
  assertNonDegenerate(src);
  assertNonDegenerate(dst);
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u]);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v, v]);
  }
  const h = solve(A, 8);
  return [...h, 1];
}

function assertNonDegenerate(pts: Pt[]): void {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const diag2 = (Math.max(...xs) - Math.min(...xs)) ** 2 + (Math.max(...ys) - Math.min(...ys)) ** 2;
  if (!(diag2 > 0)) throw new Error('degenerate point configuration');
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++)
      for (let k = j + 1; k < 4; k++) {
        const area2 =
          (pts[j][0] - pts[i][0]) * (pts[k][1] - pts[i][1]) - (pts[j][1] - pts[i][1]) * (pts[k][0] - pts[i][0]);
        if (Math.abs(area2) / 2 < 1e-9 * diag2) throw new Error('degenerate point configuration');
      }
}

function solve(M: number[][], n: number): number[] {
  const scale = Math.max(1, ...M.flat().map(Math.abs));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12 * scale) throw new Error('degenerate point configuration');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export function applyH(H: number[], p: Pt): Pt {
  const w = H[6] * p[0] + H[7] * p[1] + H[8];
  return [(H[0] * p[0] + H[1] * p[1] + H[2]) / w, (H[3] * p[0] + H[4] * p[1] + H[5]) / w];
}

export function invertH(H: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-300) throw new Error('singular homography');
  const inv = [
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d,
  ].map((v) => v / det);
  const k = inv[8];
  return inv.map((v) => v / k);
}

/**
 * Least-squares affine map (x' = a x + b y + c, y' = d x + e y + f) through point pairs, returned as a row-major
 * 3x3 with a bottom row of [0, 0, 1] so applyH works on it. Needs >= 3 non-collinear source points.
 */
export function affineFit(src: Pt[], dst: Pt[]): number[] {
  const n = src.length;
  if (n < 3 || dst.length !== n) throw new Error('affineFit needs at least 3 point pairs');
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0;
  const bu = [0, 0, 0], bv = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y;
    bu[0] += x * u; bu[1] += y * u; bu[2] += u;
    bv[0] += x * v; bv[1] += y * v; bv[2] += v;
  }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const scale = Math.max(1, sxx, syy, n);
  const solve3 = (b: number[]): number[] => {
    const A = M.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12 * scale) throw new Error('degenerate point configuration');
      [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k];
      }
    }
    return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
  };
  const a = solve3(bu), d = solve3(bv);
  return [a[0], a[1], a[2], d[0], d[1], d[2], 0, 0, 1];
}
