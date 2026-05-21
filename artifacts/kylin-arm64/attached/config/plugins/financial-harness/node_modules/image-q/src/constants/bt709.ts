/**
 * @preserve
 * Copyright 2015-2018 Igor Bezkrovnyi
 * All rights reserved. (MIT Licensed)
 *
 * constants.ts - part of Image Quantization Library
 */

/**
 * sRGB (based on ITU-R Recommendation BT.709)
 * http://en.wikipedia.org/wiki/SRGB
 */
export enum Y {
  RED = 0.2126,
  GREEN = 0.7152,
  BLUE = 0.0722,
  WHITE = 1,
}

export enum x {
  RED = 0.64,
  GREEN = 0.3,
  BLUE = 0.15,
  WHITE = 0.3127,
}

export enum y {
  RED = 0.33,
  GREEN = 0.6,
  BLUE = 0.06,
  WHITE = 0.329,
}
