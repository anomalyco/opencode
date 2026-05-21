/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * cmetric.ts - part of Image Quantization Library
 */
import { AbstractDistanceCalculator } from './distanceCalculator';
/**
 * TODO: Name it: http://www.compuphase.com/cmetric.htm
 */
export declare class CMetric extends AbstractDistanceCalculator {
    calculateRaw(r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number): number;
    protected _setDefaults(): void;
}
//# sourceMappingURL=cmetric.d.ts.map