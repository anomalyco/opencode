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
export declare class NearestColor extends AbstractImageQuantizer {
    private _distance;
    constructor(colorDistanceCalculator: AbstractDistanceCalculator);
    /**
     * Mutates pointContainer
     */
    quantize(pointContainer: PointContainer, palette: Palette): IterableIterator<ImageQuantizerYieldValue>;
}
//# sourceMappingURL=nearestColor.d.ts.map