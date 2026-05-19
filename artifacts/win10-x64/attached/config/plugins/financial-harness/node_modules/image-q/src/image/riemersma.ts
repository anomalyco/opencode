/**
 * @preserve
 * MIT License
 *
 * Copyright 2015-2018 Igor Bezkrovnyi
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 * riemersma.ts - part of Image Quantization Library
 */
import { AbstractImageQuantizer } from './imageQuantizer';
import { hilbertCurve } from './spaceFillingCurves/hilbertCurve';
import { AbstractDistanceCalculator } from '../distance/distanceCalculator';
import { PointContainer } from '../utils/pointContainer';
import { Palette } from '../utils/palette';
import { Point } from '../utils/point';
import { inRange0to255Rounded } from '../utils/arithmetic';

export class ErrorDiffusionRiemersma extends AbstractImageQuantizer {
  private _distance: AbstractDistanceCalculator;
  private _weights: number[];
  private _errorQueueSize: number;

  constructor(
    colorDistanceCalculator: AbstractDistanceCalculator,
    errorQueueSize = 16,
    errorPropagation = 1,
  ) {
    super();
    this._distance = colorDistanceCalculator;
    this._errorQueueSize = errorQueueSize;
    this._weights = ErrorDiffusionRiemersma._createWeights(
      errorPropagation,
      errorQueueSize,
    );
  }

  /**
   * Mutates pointContainer
   */
  *quantize(pointContainer: PointContainer, palette: Palette) {
    const pointArray = pointContainer.getPointArray();
    const width = pointContainer.getWidth();
    const height = pointContainer.getHeight();
    const errorQueue: Array<{
      r: number;
      g: number;
      b: number;
      a: number;
    }> = [];

    let head = 0;

    for (let i = 0; i < this._errorQueueSize; i++) {
      errorQueue[i] = { r: 0, g: 0, b: 0, a: 0 };
    }

    yield* hilbertCurve(width, height, (x, y) => {
      const p = pointArray[x + y * width];
      let { r, g, b, a } = p;
      for (let i = 0; i < this._errorQueueSize; i++) {
        const weight = this._weights[i];
        const e = errorQueue[(i + head) % this._errorQueueSize];

        r += e.r * weight;
        g += e.g * weight;
        b += e.b * weight;
        a += e.a * weight;
      }

      const correctedPoint = Point.createByRGBA(
        inRange0to255Rounded(r),
        inRange0to255Rounded(g),
        inRange0to255Rounded(b),
        inRange0to255Rounded(a),
      );

      const quantizedPoint = palette.getNearestColor(
        this._distance,
        correctedPoint,
      );

      // update head and calculate tail
      head = (head + 1) % this._errorQueueSize;
      const tail = (head + this._errorQueueSize - 1) % this._errorQueueSize;

      // update error with new value
      errorQueue[tail].r = p.r - quantizedPoint.r;
      errorQueue[tail].g = p.g - quantizedPoint.g;
      errorQueue[tail].b = p.b - quantizedPoint.b;
      errorQueue[tail].a = p.a - quantizedPoint.a;

      // update point
      p.from(quantizedPoint);
    });

    yield {
      pointContainer,
      progress: 100,
    };
  }

  private static _createWeights(
    errorPropagation: number,
    errorQueueSize: number,
  ) {
    const weights = [];

    const multiplier = Math.exp(
      Math.log(errorQueueSize) / (errorQueueSize - 1),
    );
    for (let i = 0, next = 1; i < errorQueueSize; i++) {
      weights[i] = (((next + 0.5) | 0) / errorQueueSize) * errorPropagation;
      next *= multiplier;
    }

    return weights;
  }
}
