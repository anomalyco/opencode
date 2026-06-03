/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * cie94.ts - part of Image Quantization Library
 */
import { AbstractDistanceCalculator } from './distanceCalculator';
import { rgb2lab } from '../conversion/rgb2lab';
import { inRange0to255 } from '../utils/arithmetic';

/**
 * CIE94 method of delta-e
 * http://en.wikipedia.org/wiki/Color_difference#CIE94
 */
export abstract class AbstractCIE94 extends AbstractDistanceCalculator {
  /**
   * Weight in distance: 0.25
   * Max DeltaE: 100
   * Max DeltaA: 255
   */
  declare protected _kA: number;
  declare protected _Kl: number;
  declare protected _K1: number;
  declare protected _K2: number;

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
    const lab1 = rgb2lab(
      inRange0to255(r1 * this._whitePoint.r),
      inRange0to255(g1 * this._whitePoint.g),
      inRange0to255(b1 * this._whitePoint.b),
    );
    const lab2 = rgb2lab(
      inRange0to255(r2 * this._whitePoint.r),
      inRange0to255(g2 * this._whitePoint.g),
      inRange0to255(b2 * this._whitePoint.b),
    );

    const dL = lab1.L - lab2.L;
    const dA = lab1.a - lab2.a;
    const dB = lab1.b - lab2.b;
    const c1 = Math.sqrt(lab1.a * lab1.a + lab1.b * lab1.b);
    const c2 = Math.sqrt(lab2.a * lab2.a + lab2.b * lab2.b);
    const dC = c1 - c2;

    let deltaH = dA * dA + dB * dB - dC * dC;
    deltaH = deltaH < 0 ? 0 : Math.sqrt(deltaH);

    const dAlpha = (a2 - a1) * this._whitePoint.a * this._kA;

    // TODO: add alpha channel support
    return Math.sqrt(
      (dL / this._Kl) ** 2 +
        (dC / (1.0 + this._K1 * c1)) ** 2 +
        (deltaH / (1.0 + this._K2 * c1)) ** 2 +
        dAlpha ** 2,
    );
  }
}

export class CIE94Textiles extends AbstractCIE94 {
  protected _setDefaults() {
    this._Kl = 2.0;
    this._K1 = 0.048;
    this._K2 = 0.014;
    this._kA = (0.25 * 50) / 255;
  }
}

export class CIE94GraphicArts extends AbstractCIE94 {
  protected _setDefaults() {
    this._Kl = 1.0;
    this._K1 = 0.045;
    this._K2 = 0.015;
    this._kA = (0.25 * 100) / 255;
  }
}
