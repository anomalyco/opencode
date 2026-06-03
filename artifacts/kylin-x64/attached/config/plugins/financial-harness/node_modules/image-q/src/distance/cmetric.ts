/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * cmetric.ts - part of Image Quantization Library
 */
import { AbstractDistanceCalculator } from './distanceCalculator';

/**
 * TODO: Name it: http://www.compuphase.com/cmetric.htm
 */
export class CMetric extends AbstractDistanceCalculator {
  calculateRaw(
    r1: number,
    g1: number,
    b1: number,
    a1: number,
    r2: number,
    g2: number,
    b2: number,
    a2: number,
  ) {
    const rmean = ((r1 + r2) / 2) * this._whitePoint.r;
    const r = (r1 - r2) * this._whitePoint.r;
    const g = (g1 - g2) * this._whitePoint.g;
    const b = (b1 - b2) * this._whitePoint.b;
    const dE =
      (((512 + rmean) * r * r) >> 8) +
      4 * g * g +
      (((767 - rmean) * b * b) >> 8);
    const dA = (a2 - a1) * this._whitePoint.a;

    return Math.sqrt(dE + dA * dA);
  }

  protected _setDefaults() {}
}
