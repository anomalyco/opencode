/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * common.ts - part of Image Quantization Library
 */
import { PointRGBA } from '../utils/point';

export abstract class AbstractDistanceCalculator {
  protected _maxDistance!: number;
  protected _whitePoint!: {
    r: number;
    g: number;
    b: number;
    a: number;
  };

  constructor() {
    this._setDefaults();

    // set default maximal color component deltas (255 - 0 = 255)
    this.setWhitePoint(255, 255, 255, 255);
  }

  setWhitePoint(r: number, g: number, b: number, a: number) {
    this._whitePoint = {
      r: r > 0 ? 255 / r : 0,
      g: g > 0 ? 255 / g : 0,
      b: b > 0 ? 255 / b : 0,
      a: a > 0 ? 255 / a : 0,
    };
    this._maxDistance = this.calculateRaw(r, g, b, a, 0, 0, 0, 0);
  }

  calculateNormalized(colorA: PointRGBA, colorB: PointRGBA) {
    return (
      this.calculateRaw(
        colorA.r,
        colorA.g,
        colorA.b,
        colorA.a,
        colorB.r,
        colorB.g,
        colorB.b,
        colorB.a,
      ) / this._maxDistance
    );
  }

  /**
   * Calculate raw distance (non-normalized)
   */
  abstract calculateRaw(
    r1: number,
    g1: number,
    b1: number,
    a1: number,
    r2: number,
    g2: number,
    b2: number,
    a2: number,
  ): number;

  protected abstract _setDefaults(): void;
}
