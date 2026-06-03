/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * nearestColor.ts - part of Image Quantization Library
 */
import { AbstractImageQuantizer } from './imageQuantizer';
import { AbstractDistanceCalculator } from '../distance/distanceCalculator';
import { PointContainer } from '../utils/pointContainer';
import { Palette } from '../utils/palette';
import { ImageQuantizerYieldValue } from './imageQuantizerYieldValue';
import { ProgressTracker } from '../utils/progressTracker';

export class NearestColor extends AbstractImageQuantizer {
  private _distance: AbstractDistanceCalculator;

  constructor(colorDistanceCalculator: AbstractDistanceCalculator) {
    super();
    this._distance = colorDistanceCalculator;
  }

  /**
   * Mutates pointContainer
   */
  *quantize(
    pointContainer: PointContainer,
    palette: Palette,
  ): IterableIterator<ImageQuantizerYieldValue> {
    const pointArray = pointContainer.getPointArray();
    const width = pointContainer.getWidth();
    const height = pointContainer.getHeight();

    const tracker = new ProgressTracker(height, 99);
    for (let y = 0; y < height; y++) {
      if (tracker.shouldNotify(y)) {
        yield {
          progress: tracker.progress,
        };
      }
      for (let x = 0, idx = y * width; x < width; x++, idx++) {
        // Image pixel
        const point = pointArray[idx];
        // Reduced pixel
        point.from(palette.getNearestColor(this._distance, point));
      }
    }

    yield {
      pointContainer,
      progress: 100,
    };
  }
}
