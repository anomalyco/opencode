/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * ditherErrorDiffusionArray.ts - part of Image Quantization Library
 */
import { AbstractImageQuantizer } from './imageQuantizer';
import { AbstractDistanceCalculator } from '../distance/distanceCalculator';
import { PointContainer } from '../utils/pointContainer';
import { Palette } from '../utils/palette';
import { ImageQuantizerYieldValue } from './imageQuantizerYieldValue';
export declare enum ErrorDiffusionArrayKernel {
    FloydSteinberg = 0,
    FalseFloydSteinberg = 1,
    Stucki = 2,
    Atkinson = 3,
    Jarvis = 4,
    Burkes = 5,
    Sierra = 6,
    TwoSierra = 7,
    SierraLite = 8
}
export declare class ErrorDiffusionArray extends AbstractImageQuantizer {
    private _minColorDistance;
    private _serpentine;
    private _kernel;
    /** true = GIMP, false = XNVIEW */
    private _calculateErrorLikeGIMP;
    private _distance;
    constructor(colorDistanceCalculator: AbstractDistanceCalculator, kernel: ErrorDiffusionArrayKernel, serpentine?: boolean, minimumColorDistanceToDither?: number, calculateErrorLikeGIMP?: boolean);
    /**
     * adapted from http://jsbin.com/iXofIji/2/edit by PAEz
     * fixed version. it doesn't use image pixels as error storage, also it doesn't have 0.3 + 0.3 + 0.3 + 0.3 = 0 error
     * Mutates pointContainer
     */
    quantize(pointContainer: PointContainer, palette: Palette): IterableIterator<ImageQuantizerYieldValue>;
    private _fillErrorLine;
    private _setKernel;
}
//# sourceMappingURL=array.d.ts.map