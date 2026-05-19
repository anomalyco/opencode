/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * manhattanNeuQuant.ts - part of Image Quantization Library
 */
import { AbstractDistanceCalculator } from './distanceCalculator';
/**
 * Manhattan distance (NeuQuant modification) - w/o sRGB coefficients
 */
export declare abstract class AbstractManhattan extends AbstractDistanceCalculator {
    protected _kR: number;
    protected _kG: number;
    protected _kB: number;
    protected _kA: number;
    calculateRaw(r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number): number;
}
export declare class Manhattan extends AbstractManhattan {
    protected _setDefaults(): void;
}
/**
 * Manhattan distance (Nommyde modification)
 * https://github.com/igor-bezkrovny/image-quantization/issues/4#issuecomment-235155320
 */
export declare class ManhattanNommyde extends AbstractManhattan {
    protected _setDefaults(): void;
}
/**
 * Manhattan distance (sRGB coefficients)
 */
export declare class ManhattanBT709 extends AbstractManhattan {
    protected _setDefaults(): void;
}
//# sourceMappingURL=manhattan.d.ts.map