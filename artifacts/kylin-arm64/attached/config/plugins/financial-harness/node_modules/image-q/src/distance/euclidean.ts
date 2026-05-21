/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * euclidean.ts - part of Image Quantization Library
 */
import { AbstractDistanceCalculator } from './distanceCalculator';
import { Y } from '../constants/bt709';

/**
 * Euclidean color distance
 */
export abstract class AbstractEuclidean extends AbstractDistanceCalculator {
  declare protected _kR: number;
  declare protected _kG: number;
  declare protected _kB: number;
  declare protected _kA: number;

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
    const dR = r2 - r1;
    const dG = g2 - g1;
    const dB = b2 - b1;
    const dA = a2 - a1;
    return Math.sqrt(
      this._kR * dR * dR +
        this._kG * dG * dG +
        this._kB * dB * dB +
        this._kA * dA * dA,
    );
  }
}

export class Euclidean extends AbstractEuclidean {
  protected _setDefaults() {
    this._kR = 1;
    this._kG = 1;
    this._kB = 1;
    this._kA = 1;
  }
}

/**
 * Euclidean color distance (RGBQuant modification w Alpha)
 */
export class EuclideanBT709 extends AbstractEuclidean {
  protected _setDefaults() {
    this._kR = Y.RED;
    this._kG = Y.GREEN;
    this._kB = Y.BLUE;
    // TODO: what is the best coefficient below?
    this._kA = 1;
  }
}

/**
 * Euclidean color distance (RGBQuant modification w/o Alpha)
 */
export class EuclideanBT709NoAlpha extends AbstractEuclidean {
  protected _setDefaults() {
    this._kR = Y.RED;
    this._kG = Y.GREEN;
    this._kB = Y.BLUE;
    this._kA = 0;
  }
}
