/*
 * Copyright (c) 2015, Leon Sorokin
 * All rights reserved. (MIT Licensed)
 *
 * RGBQuant.js - an image quantization lib
 */

/**
 * @preserve TypeScript port:
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * rgbquant.ts - part of Image Quantization Library
 */

import { Palette } from '../../utils/palette';
import { Point } from '../../utils/point';
import { PointContainer } from '../../utils/pointContainer';
import { AbstractDistanceCalculator } from '../../distance/distanceCalculator';
import { ColorHistogram } from './colorHistogram';
import { AbstractPaletteQuantizer } from '../paletteQuantizer';
import { PaletteQuantizerYieldValue } from '../paletteQuantizerYieldValue';
import { stableSort } from '../../utils/arithmetic';
import { ProgressTracker } from '../../utils';

class RemovedColor {
  readonly index: number;
  readonly color: Point;
  readonly distance: number;

  constructor(index: number, color: Point, distance: number) {
    this.index = index;
    this.color = color;
    this.distance = distance;
  }
}

// TODO: make input/output image and input/output palettes with instances of class Point only!
export class RGBQuant extends AbstractPaletteQuantizer {
  // desired final palette size
  private readonly _colors: number;

  // color-distance threshold for initial reduction pass
  private readonly _initialDistance: number;

  // subsequent passes threshold
  private readonly _distanceIncrement: number;

  // accumulated histogram
  private readonly _histogram: ColorHistogram;
  private readonly _distance: AbstractDistanceCalculator;

  constructor(
    colorDistanceCalculator: AbstractDistanceCalculator,
    colors = 256,
    method = 2,
  ) {
    super();
    this._distance = colorDistanceCalculator;
    // desired final palette size
    this._colors = colors;

    // histogram to accumulate
    this._histogram = new ColorHistogram(method, colors);

    this._initialDistance = 0.01;
    this._distanceIncrement = 0.005;
  }

  // gathers histogram info
  sample(image: PointContainer) {
    /*
     var pointArray = image.getPointArray(), max = [0, 0, 0, 0], min = [255, 255, 255, 255];

     for (var i = 0, l = pointArray.length; i < l; i++) {
     var color = pointArray[i];
     for (var componentIndex = 0; componentIndex < 4; componentIndex++) {
     if (max[componentIndex] < color.rgba[componentIndex]) max[componentIndex] = color.rgba[componentIndex];
     if (min[componentIndex] > color.rgba[componentIndex]) min[componentIndex] = color.rgba[componentIndex];
     }
     }
     var rd = max[0] - min[0], gd = max[1] - min[1], bd = max[2] - min[2], ad = max[3] - min[3];
     this._distance.setWhitePoint(rd, gd, bd, ad);

     this._initialDistance = (Math.sqrt(rd * rd + gd * gd + bd * bd + ad * ad) / Math.sqrt(255 * 255 + 255 * 255 + 255 * 255)) * 0.01;
     */

    this._histogram.sample(image);
  }

  // reduces histogram to palette, remaps & memoizes reduced colors
  *quantize() {
    const idxi32 = this._histogram.getImportanceSortedColorsIDXI32();
    if (idxi32.length === 0) {
      throw new Error('No colors in image');
    }

    yield* this._buildPalette(idxi32);
  }

  // reduces similar colors from an importance-sorted Uint32 rgba array
  private *_buildPalette(
    idxi32: number[],
  ): IterableIterator<PaletteQuantizerYieldValue> {
    // reduce histogram to create initial palette
    // build full rgb palette
    const palette = new Palette();
    const colorArray = palette.getPointContainer().getPointArray();
    const usageArray = new Array(idxi32.length);

    for (let i = 0; i < idxi32.length; i++) {
      colorArray.push(Point.createByUint32(idxi32[i]));
      usageArray[i] = 1;
    }

    const len = colorArray.length;
    const memDist = [];

    let palLen = len;
    let thold = this._initialDistance;

    // palette already at or below desired length
    const tracker = new ProgressTracker(palLen - this._colors, 99);
    while (palLen > this._colors) {
      memDist.length = 0;

      // iterate palette
      for (let i = 0; i < len; i++) {
        if (tracker.shouldNotify(len - palLen)) {
          yield {
            progress: tracker.progress,
          };
        }

        if (usageArray[i] === 0) continue;
        const pxi = colorArray[i];
        // if (!pxi) continue;

        for (let j = i + 1; j < len; j++) {
          if (usageArray[j] === 0) continue;
          const pxj = colorArray[j];
          // if (!pxj) continue;

          const dist = this._distance.calculateNormalized(pxi, pxj);
          if (dist < thold) {
            // store index,rgb,dist
            memDist.push(new RemovedColor(j, pxj, dist));
            usageArray[j] = 0;
            palLen--;
          }
        }
      }
      // palette reduction pass
      // console.log("palette length: " + palLen);

      // if palette is still much larger than target, increment by larger initDist
      thold +=
        palLen > this._colors * 3
          ? this._initialDistance
          : this._distanceIncrement;
    }

    // if palette is over-reduced, re-add removed colors with largest distances from last round
    if (palLen < this._colors) {
      // sort descending
      stableSort(memDist, (a, b) => b.distance - a.distance);

      let k = 0;
      while (palLen < this._colors && k < memDist.length) {
        const removedColor = memDist[k];
        // re-inject rgb into final palette
        usageArray[removedColor.index] = 1;
        palLen++;
        k++;
      }
    }

    let colors = colorArray.length;
    for (let colorIndex = colors - 1; colorIndex >= 0; colorIndex--) {
      if (usageArray[colorIndex] === 0) {
        if (colorIndex !== colors - 1) {
          colorArray[colorIndex] = colorArray[colors - 1];
        }
        --colors;
      }
    }
    colorArray.length = colors;

    palette.sort();

    yield {
      palette,
      progress: 100,
    };
  }
}
