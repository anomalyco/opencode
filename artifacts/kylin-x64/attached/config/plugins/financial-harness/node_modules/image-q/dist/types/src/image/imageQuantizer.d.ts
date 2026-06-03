/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * common.ts - part of Image Quantization Library
 */
import { PointContainer } from '../utils/pointContainer';
import { Palette } from '../utils/palette';
import { ImageQuantizerYieldValue } from './imageQuantizerYieldValue';
export declare abstract class AbstractImageQuantizer {
    abstract quantize(pointContainer: PointContainer, palette: Palette): IterableIterator<ImageQuantizerYieldValue>;
    quantizeSync(pointContainer: PointContainer, palette: Palette): PointContainer;
}
//# sourceMappingURL=imageQuantizer.d.ts.map