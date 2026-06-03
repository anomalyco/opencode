# pixelmatch

[![Build Status](https://travis-ci.org/mapbox/pixelmatch.svg?branch=master)](https://travis-ci.org/mapbox/pixelmatch)
[![](https://img.shields.io/badge/simply-awesome-brightgreen.svg)](https://github.com/mourner/projects)

The smallest, simplest and fastest JavaScript pixel-level image comparison library,
originally created to compare screenshots in tests.

Features accurate **anti-aliased pixels detection**
and **perceptual color difference metrics**.

Inspired by [Resemble.js](https://github.com/Huddle/Resemble.js)
and [Blink-diff](https://github.com/yahoo/blink-diff).
Unlike these libraries, pixelmatch is around **150 lines of code**,
has **no dependencies**, and works on **raw typed arrays** of image data,
so it's **blazing fast** and can be used in **any environment** (Node or browsers).

```js
const numDiffPixels = pixelmatch(img1, img2, diff, 800, 600, {threshold: 0.1});
```

Implements ideas from the following papers:

- [Measuring perceived color difference using YIQ NTSC transmission color space in mobile applications](http://www.progmat.uaem.mx:8080/artVol2Num2/Articulo3Vol2Num2.pdf) (2010, Yuriy Kotsarenko, Fernando Ramos)
- [Anti-aliased pixel and intensity slope detector](https://www.researchgate.net/publication/234126755_Anti-aliased_Pixel_and_Intensity_Slope_Detector) (2009, Vytautas Vyšniauskas)

## [Demo](https://observablehq.com/@mourner/pixelmatch-demo)

## Example output

| expected | actual | diff |
| --- | --- | --- |
| ![](test/fixtures/4a.png) | ![](test/fixtures/4b.png) | ![1diff](test/fixtures/4diff.png) |
| ![](test/fixtures/3a.png) | ![](test/fixtures/3b.png) | ![1diff](test/fixtures/3diff.png) |
| ![](test/fixtures/6a.png) | ![](test/fixtures/6b.png) | ![1diff](test/fixtures/6diff.png) |

## API

### pixelmatch(img1, img2, output, width, height[, options])

- `img1`, `img2` — Image data of the images to compare (`Buffer`, `Uint8Array` or `Uint8ClampedArray`). **Note:** image dimensions must be equal.
- `output` — Image data to write the diff to, or `null` if don't need a diff image.
- `width`, `height` — Width and height of the images. Note that _all three images_ need to have the same dimensions.

`options` is an object literal with the following properties:

- `threshold` — Matching threshold, ranges from `0` to `1`. Smaller values make the comparison more sensitive. `0.1` by default.
- `includeAA` — If `true`, disables detecting and ignoring anti-aliased pixels. `false` by default.
- `alpha` — Blending factor of unchanged pixels in the diff output. Ranges from `0` for pure white to `1` for original brightness. `0.1` by default.
- `aaColor` — The color of anti-aliased pixels in the diff output in `[R, G, B]` format. `[255, 255, 0]` by default.
- `diffColor` — The color of differing pixels in the diff output in `[R, G, B]` format. `[255, 0, 0]` by default.
- `diffColorAlt` — An alternative color to use for dark on light differences to differentiate between "added" and "removed" parts. If not provided, all differing pixels use the color specified by `diffColor`. `null` by default.
- `diffMask` — Draw the diff over a transparent background (a mask), rather than over the original image. Will not draw anti-aliased pixels (if detected).

Compares two images, writes the output diff and returns the number of mismatched pixels.

## Command line

Pixelmatch comes with a binary that works with PNG images:

```bash
pixelmatch image1.png image2.png output.png 0.1
```

## Example usage

### Node.js

```js
const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch');

const img1 = PNG.sync.read(fs.readFileSync('img1.png'));
const img2 = PNG.sync.read(fs.readFileSync('img2.png'));
const {width, height} = img1;
const diff = new PNG({width, height});

pixelmatch(img1.data, img2.data, diff.data, width, height, {threshold: 0.1});

fs.writeFileSync('diff.png', PNG.sync.write(diff));
```

### Browsers

```js
const img1 = img1Context.getImageData(0, 0, width, height);
const img2 = img2Context.getImageData(0, 0, width, height);
const diff = diffContext.createImageData(width, height);

pixelmatch(img1.data, img2.data, diff.data, width, height, {threshold: 0.1});

diffContext.putImageData(diff, 0, 0);
```

## Install

Install with NPM:

```bash
npm install pixelmatch
```

Use in the browser from a CDN:

```html
<script src="https://bundle.run/pixelmatch"></script>
```

## [Changelog](https://github.com/mapbox/pixelmatch/releases)
