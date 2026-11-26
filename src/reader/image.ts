import type { RGBA } from '../sheet/raster';

export interface Gray { width: number; height: number; data: Uint8Array }

export function toGray(img: RGBA): Gray {
  const n = img.width * img.height;
  const data = new Uint8Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) data[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
  return { width: img.width, height: img.height, data };
}

/** Box-filter downscale so the longer side is at most maxDim. Returns `img` itself when already small enough. */
export function downscale(img: RGBA, maxDim: number): RGBA {
  const longest = Math.max(img.width, img.height);
  if (longest <= maxDim) return img;
  const s = longest / maxDim;
  const width = Math.max(1, Math.round(img.width / s));
  const height = Math.max(1, Math.round(img.height / s));
  const sx = img.width / width, sy = img.height / height;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.min(img.height, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.min(img.width, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * img.width + xx) * 4;
          r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++;
        }
      const o = (y * width + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

/** Bilinear sample at continuous coordinates where pixel i covers [i, i+1); clamps at the edges. */
export function sampleGray(g: Gray, x: number, y: number): number {
  const fx = Math.min(Math.max(x - 0.5, 0), g.width - 1);
  const fy = Math.min(Math.max(y - 0.5, 0), g.height - 1);
  const ix = Math.min(Math.floor(fx), Math.max(0, g.width - 2));
  const iy = Math.min(Math.floor(fy), Math.max(0, g.height - 2));
  const ix1 = Math.min(ix + 1, g.width - 1), iy1 = Math.min(iy + 1, g.height - 1);
  const tx = fx - ix, ty = fy - iy;
  const d = g.data, w = g.width;
  return (
    d[iy * w + ix] * (1 - tx) * (1 - ty) + d[iy * w + ix1] * tx * (1 - ty) +
    d[iy1 * w + ix] * (1 - tx) * ty + d[iy1 * w + ix1] * tx * ty
  );
}
