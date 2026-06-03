/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * cie94.ts - part of Image Quantization Library
 */
import { AbstractDistanceCalculator } from './distanceCalculator';
/**
 * CIE94 method of delta-e
 * http://en.wikipedia.org/wiki/Color_difference#CIE94
 */
export declare abstract class AbstractCIE94 extends AbstractDistanceCalculator {
    /**
     * Weight in distance: 0.25
     * Max DeltaE: 100
     * Max DeltaA: 255
     */
    protected _kA: number;
    protected _Kl: number;
    protected _K1: number;
    protected _K2: number;
    calculateRaw(r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number): number;
}
export declare class CIE94Textiles extends AbstractCIE94 {
    protected _setDefaults(): void;
}
export declare class CIE94GraphicArts extends AbstractCIE94 {
    protected _setDefaults(): void;
}
//# sourceMappingURL=cie94.d.ts.map