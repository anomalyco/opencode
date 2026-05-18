/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * euclidean.ts - part of Image Quantization Library
 */
import { AbstractDistanceCalculator } from './distanceCalculator';
/**
 * Euclidean color distance
 */
export declare abstract class AbstractEuclidean extends AbstractDistanceCalculator {
    protected _kR: number;
    protected _kG: number;
    protected _kB: number;
    protected _kA: number;
    calculateRaw(r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number): number;
}
export declare class Euclidean extends AbstractEuclidean {
    protected _setDefaults(): void;
}
/**
 * Euclidean color distance (RGBQuant modification w Alpha)
 */
export declare class EuclideanBT709 extends AbstractEuclidean {
    protected _setDefaults(): void;
}
/**
 * Euclidean color distance (RGBQuant modification w/o Alpha)
 */
export declare class EuclideanBT709NoAlpha extends AbstractEuclidean {
    protected _setDefaults(): void;
}
//# sourceMappingURL=euclidean.d.ts.map