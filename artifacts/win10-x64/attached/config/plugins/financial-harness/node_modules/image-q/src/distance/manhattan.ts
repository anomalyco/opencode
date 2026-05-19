/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * manhattanNeuQuant.ts - part of Image Quantization Library
 */
import { AbstractDistanceCalculator } from './distanceCalculator';
import { Y } from '../constants/bt709';

/**
 * Manhattan distance (NeuQuant modification) - w/o sRGB coefficients
 */
export abstract class AbstractManhattan extends AbstractDistanceCalculator {
  declare protected _kR: number;
  declare  protected _kG: number;
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
    let dR = r2 - r1;
    let dG = g2 - g1;
    let dB = b2 - b1;
    let dA = a2 - a1;
    if (dR < 0) dR = 0 - dR;
    if (dG < 0) dG = 0 - dG;
    if (dB < 0) dB = 0 - dB;
    if (dA < 0) dA = 0 - dA;

    return this._kR * dR + this._kG * dG + this._kB * dB + this._kA * dA;
  }
}

export class Manhattan extends AbstractManhattan {
  protected _setDefaults() {
    this._kR = 1;
    this._kG = 1;
    this._kB = 1;
    this._kA = 1;
  }
}

/**
 * Manhattan distance (Nommyde modification)
 * https://github.com/igor-bezkrovny/image-quantization/issues/4#issuecomment-235155320
 */
export class ManhattanNommyde extends AbstractManhattan {
  protected _setDefaults() {
    this._kR = 0.4984;
    this._kG = 0.8625;
    this._kB = 0.2979;
    // TODO: what is the best coefficient below?
    this._kA = 1;
  }
}

/**
 * Manhattan distance (sRGB coefficients)
 */
export class ManhattanBT709 extends AbstractManhattan {
  protected _setDefaults() {
    this._kR = Y.RED;
    this._kG = Y.GREEN;
    this._kB = Y.BLUE;
    // TODO: what is the best coefficient below?
    this._kA = 1;
  }
}
