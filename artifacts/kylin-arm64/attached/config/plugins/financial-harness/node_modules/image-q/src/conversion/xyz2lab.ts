/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * xyz2lab.ts - part of Image Quantization Library
 */
const refX = 0.95047; // ref_X =  95.047   Observer= 2°, Illuminant= D65
const refY = 1.0; // ref_Y = 100.000
const refZ = 1.08883; // ref_Z = 108.883

function pivot(n: number) {
  return n > 0.008856 ? n ** (1 / 3) : 7.787 * n + 16 / 116;
}

export function xyz2lab(x: number, y: number, z: number) {
  x = pivot(x / refX);
  y = pivot(y / refY);
  z = pivot(z / refZ);

  if (116 * y - 16 < 0) throw new Error('xxx');
  return {
    L: Math.max(0, 116 * y - 16),
    a: 500 * (x - y),
    b: 200 * (y - z),
  };
}
