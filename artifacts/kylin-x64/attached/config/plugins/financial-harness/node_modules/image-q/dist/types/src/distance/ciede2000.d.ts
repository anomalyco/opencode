/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * ciede2000.ts - part of Image Quantization Library
 */
import { AbstractDistanceCalculator } from './distanceCalculator';
/**
 * CIEDE2000 algorithm - Adapted from Sharma et al's MATLAB implementation at
 * http://www.ece.rochester.edu/~gsharma/ciede2000/
 */
export declare class CIEDE2000 extends AbstractDistanceCalculator {
    /**
     * Weight in distance: 0.25
     * Max DeltaE: 100
     * Max DeltaA: 255
     */
    private static readonly _kA;
    private static readonly _pow25to7;
    private static readonly _deg360InRad;
    private static readonly _deg180InRad;
    private static readonly _deg30InRad;
    private static readonly _deg6InRad;
    private static readonly _deg63InRad;
    private static readonly _deg275InRad;
    private static readonly _deg25InRad;
    protected _setDefaults(): void;
    private static _calculatehp;
    private static _calculateRT;
    private static _calculateT;
    private static _calculate_ahp;
    private static _calculate_dHp;
    calculateRaw(r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number): number;
    calculateRawInLab(Lab1: {
        L: number;
        a: number;
        b: number;
    }, Lab2: {
        L: number;
        a: number;
        b: number;
    }): number;
}
//# sourceMappingURL=ciede2000.d.ts.map