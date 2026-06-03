/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * lab2rgb.ts - part of Image Quantization Library
 */
import { lab2xyz } from './lab2xyz';
import { xyz2rgb } from './xyz2rgb';

export function lab2rgb(L: number, a: number, b: number) {
  const xyz = lab2xyz(L, a, b);
  return xyz2rgb(xyz.x, xyz.y, xyz.z);
}
