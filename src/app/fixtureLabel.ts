import type { RGBA } from '../sheet/raster';

export const LABEL_STRIP_PX = 48;

/** Prepend a solid background-gray strip so the FIXTURE label never overlaps paper. */
export function withLabelStrip(img: RGBA, stripPx = LABEL_STRIP_PX, background = 90): RGBA {
  const data = new Uint8ClampedArray(img.width * (img.height + stripPx) * 4);
  const stripBytes = img.width * stripPx * 4;
  for (let i = 0; i < stripBytes; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = background;
    data[i + 3] = 255;
  }
  data.set(img.data, stripBytes);
  return { width: img.width, height: img.height + stripPx, data };
}
