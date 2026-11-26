import { applyH, homography, type Pt } from '../geometry/homography';
import type { RGBA } from './raster';

export interface PhotoOptions {
  width: number;
  height: number;
  /** Page TL, TR, BL, BR in output px. */
  corners: [Pt, Pt, Pt, Pt];
  lightGradient: number;
  noise: number;
  background: number;
  seed: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function defaultPhotoOptions(seed: number): PhotoOptions {
  const width = 1200, height = 1600;
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const ph = height * 0.9, pw = ph * (210 / 297);
  const x0 = (width - pw) / 2, y0 = (height - ph) / 2;
  const j = (): number => (rnd() * 2 - 1) * 0.04;
  const corner = (x: number, y: number): Pt => [x + j() * width, y + j() * height];
  return {
    width, height,
    corners: [corner(x0, y0), corner(x0 + pw, y0), corner(x0, y0 + ph), corner(x0 + pw, y0 + ph)],
    lightGradient: 0.2, noise: 8, background: 90, seed,
  };
}

export function simulatePhoto(page: RGBA, opts: PhotoOptions): RGBA {
  const { width, height } = opts;
  const pageCorners: Pt[] = [[0, 0], [page.width, 0], [0, page.height], [page.width, page.height]];
  const H = homography(opts.corners, pageCorners); // photo px -> page px
  const rnd = mulberry32(opts.seed);
  const data = new Uint8ClampedArray(width * height * 4);
  const px = (x: number, y: number) => page.data[(y * page.width + x) * 4];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [u, v] = applyH(H, [x + 0.5, y + 0.5]);
      let val: number;
      if (u < 0 || v < 0 || u >= page.width || v >= page.height) val = opts.background;
      else {
        const fx = Math.min(Math.max(u - 0.5, 0), page.width - 1), fy = Math.min(Math.max(v - 0.5, 0), page.height - 1);
        const ix = Math.min(Math.floor(fx), page.width - 2), iy = Math.min(Math.floor(fy), page.height - 2);
        const tx = fx - ix, ty = fy - iy;
        val =
          px(ix, iy) * (1 - tx) * (1 - ty) + px(ix + 1, iy) * tx * (1 - ty) +
          px(ix, iy + 1) * (1 - tx) * ty + px(ix + 1, iy + 1) * tx * ty;
      }
      val = val * (1 - (opts.lightGradient * x) / width) + (rnd() * 2 - 1) * opts.noise;
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = val;
      data[o + 3] = 255;
    }
  return { width, height, data };
}
