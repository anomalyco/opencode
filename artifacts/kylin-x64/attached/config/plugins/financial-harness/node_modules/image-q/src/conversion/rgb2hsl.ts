/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * rgb2hsl.ts - part of Image Quantization Library
 */
import { min3, max3 } from '../utils/arithmetic';

/**
 * Calculate HSL from RGB
 * Hue is in degrees [0..360]
 * Lightness: [0..1]
 * Saturation: [0..1]
 * http://web.archive.org/web/20060914040436/http://local.wasp.uwa.edu.au/~pbourke/colour/hsl/
 */
export function rgb2hsl(r: number, g: number, b: number) {
  const min = min3(r, g, b);
  const max = max3(r, g, b);
  const delta = max - min;
  const l = (min + max) / 510;

  let s = 0;
  if (l > 0 && l < 1) s = delta / (l < 0.5 ? max + min : 510 - max - min);

  let h = 0;
  if (delta > 0) {
    if (max === r) {
      h = (g - b) / delta;
    } else if (max === g) {
      h = 2 + (b - r) / delta;
    } else {
      h = 4 + (r - g) / delta;
    }

    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}
