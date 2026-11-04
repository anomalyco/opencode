/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */
import type { MeasureFunction } from "../../../yoga.js";
export type MeasureCounter = {
    inc: MeasureFunction;
    get: () => number;
};
export declare function getMeasureCounter(cb?: MeasureFunction | null, staticWidth?: number, staticHeight?: number): MeasureCounter;
export declare function getMeasureCounterMax(): MeasureCounter;
export declare function getMeasureCounterMin(): MeasureCounter;
