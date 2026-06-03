/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * rgb2xyz.ts - part of Image Quantization Library
 */
function correctGamma(n: number) {
  return n > 0.04045 ? ((n + 0.055) / 1.055) ** 2.4 : n / 12.92;
}

export function rgb2xyz(r: number, g: number, b: number) {
  // gamma correction, see https://en.wikipedia.org/wiki/SRGB#The_reverse_transformation
  r = correctGamma(r / 255);
  g = correctGamma(g / 255);
  b = correctGamma(b / 255);

  // Observer. = 2°, Illuminant = D65
  return {
    x: r * 0.4124 + g * 0.3576 + b * 0.1805,
    y: r * 0.2126 + g * 0.7152 + b * 0.0722,
    z: r * 0.0193 + g * 0.1192 + b * 0.9505,
  };
}
