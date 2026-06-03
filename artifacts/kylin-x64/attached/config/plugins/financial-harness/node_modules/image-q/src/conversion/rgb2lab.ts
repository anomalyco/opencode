/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * rgb2lab.ts - part of Image Quantization Library
 */
import { rgb2xyz } from './rgb2xyz';
import { xyz2lab } from './xyz2lab';

export function rgb2lab(r: number, g: number, b: number) {
  const xyz = rgb2xyz(r, g, b);
  return xyz2lab(xyz.x, xyz.y, xyz.z);
}
