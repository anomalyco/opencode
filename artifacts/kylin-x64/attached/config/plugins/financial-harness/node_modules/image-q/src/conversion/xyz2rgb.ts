/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * xyz2rgb.ts - part of Image Quantization Library
 */
import { inRange0to255Rounded } from '../utils/arithmetic';

// gamma correction, see https://en.wikipedia.org/wiki/SRGB#The_reverse_transformation
function correctGamma(n: number) {
  return n > 0.0031308 ? 1.055 * n ** (1 / 2.4) - 0.055 : 12.92 * n;
}

export function xyz2rgb(x: number, y: number, z: number) {
  // Observer. = 2°, Illuminant = D65
  const r = correctGamma(x * 3.2406 + y * -1.5372 + z * -0.4986);
  const g = correctGamma(x * -0.9689 + y * 1.8758 + z * 0.0415);
  const b = correctGamma(x * 0.0557 + y * -0.204 + z * 1.057);

  return {
    r: inRange0to255Rounded(r * 255),
    g: inRange0to255Rounded(g * 255),
    b: inRange0to255Rounded(b * 255),
  };
}
