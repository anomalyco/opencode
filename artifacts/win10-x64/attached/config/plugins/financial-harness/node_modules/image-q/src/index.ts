/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * iq.ts - Image Quantization Library
 */
import * as constants from './constants';
import * as conversion from './conversion';
import * as distance from './distance';
import * as palette from './palette';
import * as image from './image';
import * as quality from './quality';
import * as utils from './utils';

export {
  buildPalette,
  buildPaletteSync,
  applyPalette,
  applyPaletteSync,
} from './basicAPI';

export type {
  ImageQuantization,
  PaletteQuantization,
  ColorDistanceFormula,
} from './basicAPI';

export { constants, conversion, distance, palette, image, quality, utils };
