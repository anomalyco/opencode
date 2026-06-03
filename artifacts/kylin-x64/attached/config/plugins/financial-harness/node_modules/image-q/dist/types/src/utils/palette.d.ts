/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * palette.ts - part of Image Quantization Library
 */
import { Point } from './point';
import { PointContainer } from './pointContainer';
import { AbstractDistanceCalculator } from '../distance/distanceCalculator';
export declare function hueGroup(hue: number, segmentsNumber: number): number;
export declare class Palette {
    private readonly _pointContainer;
    private readonly _pointArray;
    private _i32idx;
    constructor();
    add(color: Point): void;
    has(color: Point): boolean;
    getNearestColor(colorDistanceCalculator: AbstractDistanceCalculator, color: Point): Point;
    getPointContainer(): PointContainer;
    private _nearestPointFromCache;
    private _getNearestIndex;
    sort(): void;
}
//# sourceMappingURL=palette.d.ts.map