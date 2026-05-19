## image-q

Complete Image Quantization Library in **TypeScript** _(MIT License)_

[![Demo (outdated, use /packages/demo for up-to-date demo)](https://img.shields.io/badge/demo-online-brightgreen.svg)](https://ibezkrovnyi.github.io/image-quantization-demo/)
[![GitHub](https://img.shields.io/badge/github-.com-brightgreen.svg)](https://github.com/ibezkrovnyi/image-quantization/tree/main/packages/image-q)
[![NPM](https://badge.fury.io/js/image-q.svg)](https://www.npmjs.com/package/image-q)
[![API)](https://img.shields.io/badge/API-Available-blue.svg)](http://ibezkrovnyi.github.io/image-quantization/)
[![NPM License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![quantization](packages/image-q/quantization.png)

## Table of Contents

- [<span style="color: red">API Documentation and Usage</span>](http://ibezkrovnyi.github.io/image-quantization/)
- [Introduction](#introduction)
- [Features](#features)
- [Todo](#todo)
- [Breaking changes](#breaking-changes)
- [Changelog](#changelog)
- [Credits](#credits)
- [References](#references)
- [License](#license)

## Introduction

Image Color Number Reduction with alpha support using RGBQuant/NeuQuant/Xiaolin Wu's algorithms and Euclidean/Manhattan/CIEDE2000 color distance formulas in TypeScript

## Features

1. Platforms supported

   - Browser (Chrome 7.0+, FireFox 4.0+, IE 10+, Opera 11.6+, Safari 5.1+)
   - Node.js 6.0+

2. API
   - Basic API: sync and promise-based async
   - Advanced API: sync and generator-based
3. Builds

   - `dist/cjs/image-q.js` - CommonJS
   - `dist/esm/image-q.js` - ESM (ESNext)
   - `dist/cjs/image-q.js` - UMD

4. Import
   - `HTMLImageElement`
   - `HTMLCanvasElement`
   - `NodeCanvas`
   - `ImageData`
   - `Array`
   - `CanvasPixelArray`
   - `Uint8Array`
   - `Uint32Array`
5. Color Distance

   - `Euclidean` - 1/1/1/1 coefficients (originally used in Xiaolin Wu's Quantizer **WuQuant**)
   - `EuclideanBT709NoAlpha` - BT.709 sRGB coefficients (originally used in **RGBQuant**)
   - `EuclideanBT709` BT.709 sRGB coefficients + alpha support
   - `Manhattan` - 1/1/1/1 coefficients (originally used in **NeuQuant**)
   - `ManhattanBT709` - BT.709 sRGB coefficients
   - `ManhattanNommyde` - see https://github.com/igor-bezkrovny/image-quantization/issues/4#issuecomment-234527620
   - `CIEDE2000` - CIEDE2000 (very slow)
   - `CIE94Textiles` - CIE94 implementation for textiles
   - `CIE94GraphicArts` - CIE94 implementation for graphic arts
   - `CMetric` - see http://www.compuphase.com/cmetric.htm
   - `PNGQuant` - used in pngQuant tool

6. Palette Quantizers
   - `NeuQuant` (original code ported, integer calculations)
   - `NeuQuantFloat` (floating-point calculations)
   - `RGBQuant`
   - `WuQuant`
7. Image Quantizers

   - `NearestColor`
   - `ErrorDiffusionArray` - two modes of error propagation are supported: `xnview` and `gimp`
     1. `FloydSteinberg`
     2. `FalseFloydSteinberg`
     3. `Stucki`
     4. `Atkinson`
     5. `Jarvis`
     6. `Burkes`
     7. `Sierra`
     8. `TwoSierra`
     9. `SierraLite`
   - `ErrorDiffusionRiemersma` - Hilbert space-filling curve is used

8. Output
   - `Uint32Array`
   - `Uint8Array`

## Include `image-q` library into your project

##### ES6 module

```javascript
// will import ESM (ESNext) or UMD version depending on your bundler/node
import * as iq from 'image-q';
```

##### CommonJS

```javascript
var iq = require('image-q');
```

##### As a global variable (Browser)

```html
<script
  src="<path-to image-q/dist/umd/image-q.js>"
  type="text/javascript"
  charset="utf-8"
></script>
```

## How to use

Please refer to [API Documentation and Usage](http://ibezkrovnyi.github.io/image-quantization/)

## Breaking changes

#### 2.1.1

    + PaletteQuantizer#quantize => PaletteQuantizer#quantizeSync
    + ImageQuantizer#quantize => ImageQuantizer#quantizeSync

#### 2.0.1 - 2.0.4 (2018-02-22)

    + EuclideanRgbQuantWOAlpha => EuclideanBT709NoAlpha
    + EuclideanRgbQuantWithAlpha => EuclideanBT709
    	+ ManhattanSRGB => ManhattanBT709
    	+ IImageDitherer => AbstractImageQuantizer
    	+ IPaletteQuantizer => AbstractPaletteQuantizer
    	+ PointContainer.fromNodeCanvas => PointContainer.fromHTMLCanvasElement
    	+ PointContainer.fromArray => PointContainer.fromUint8Array
    + PointContainer.fromBuffer (Node.js, new)
    	+ CMETRIC => CMetric
    	+ PNGQUANT => PNGQuant
    	+ SSIM Class => ssim function

## TODO

1. ~~notification about progress~~
2. ~~riemersma dithering~~
3. ordered dithering <-- is there anyone who needs it?
4. readme update, more examples
5. demo update (latest image-q npm version should be used in demo)

## Changelog

##### 4.0.0
    + Test cases for different types of imports and requres added

##### 4.0.0-alpha
    + Try to solve exported bundle types problem. 'umd' bundle removed.

##### 3.0.8
    + Test case for issue #95 added

##### 3.0.7
    + Fixes #96: Fix minimumColorDistanceToDither (PR #97 by @pixelplanetdev)

##### 3.0.6
    + Fixes #95: "Always empty result in certain webpack / babel configs" (PR #98)

##### 3.0.4
    + Fixes issue "Module not found: Can't resolve 'core-js/fn/set-immediate' in ..."

##### 3.0.0
    + pnpm monorepo, esbuild for faster builds, typescript upgraded

##### 2.1.1

    + Basic (Simple) API implemented
    + see breaking changes

##### 2.0.5 (2018-02-23)

    + @types/node moved to 'dependencies'

##### 2.0.4 (2018-02-23)

    + documentation added
    + some refactorings/renames, see breaking changes

##### 2.0.3 (2018-02-22)

    + circular dependency removed

##### 2.0.2 (2018-02-22)

    + readme updated

##### 2.0.1 (2018-02-22)

    + progress tracking api (using es6 generators) added
    + strinct lint rules (+code cleanup/renames)
    + rollup (3 different versions - umd, cjs, esm + source maps + d.ts)
    + latest TypeScript
    + jest
    + snapshot tests
    + coverage (+coveralls)
    + greenkeeper

##### 1.1.1 (2016-08-28)

    + CIEDE2000 - incorrect calculation fixed
    + CIEDE2000 - alpha channel now has only 25% impact on color distance instead of 66%
    + CIE94 - added 2 types (textiles and graphics art) according to spec
    + CIE94 - alpha support added
    + rgb2xyz, lab2xyz, xyz2rgb, xyz2lab - gamma correction
    + lab2xyz, xyz2lab - refY should be 100 (1.00000) instead of 10 (0.10000)
    + manhattan with new (Nommyde) coefficients added
    + mocha tests added
    + webpack integration
    + image-q is now UMD module
    + travis-ci integration
    + typescript 2.0
    + indentation with 4 spaces

##### 0.1.4 (2015-06-24)

    + Refactoring
    + Riemersma dithering added (Hilbert Curve)
    + Readme.md updated
    + build.cmd updated

##### 0.1.3 (2015-06-16)

    + NeuQuant is fixed (again) according to original Anthony Dekker source code (all values should be integer)
    + Error Diffusion Dithering is now calculates error like XNVIEW
    + Refactoring

##### 0.1.2 (2015-06-16)

    + Documentation generation fixed
    + File name case problem fixed

##### 0.1.1 (2015-06-16)

    + Auto-generated documentation added
    + Refactoring

##### 0.1.0 (2015-06-16)

    + Code cleanup, removed unnecessary files

##### 0.0.5 (2015-06-16)

    + PNGQuant color distance added, need to check its quality
    + CIEDE2000 and CIE94 fixed for use in NeuQuant
    + NeuQuant is fixed according to original Anthony Dekker source code (all values should be integer)
    + Code refactoring and cleanup
    * We have some slowdown because of red/green/blue/alpha normalization according to white point per each calculateRaw/calculateNormalized call

##### 0.0.4 (2015-06-15)

    + CIEDE2000 color distance equation optimized (original CIEDE2000 equation is available as class `CIEDE2000_Original`)

##### 0.0.3b (2015-06-11)

    + CMetric color distance fixed

##### 0.0.3a (2015-06-11)

    + Cleanup
    + Draft of CMetric color distance added

##### 0.0.2 (2015-06-10)

    + rgb2xyz & xyz2lab fixed. CIEDE2000 works much better now.
    + CIE94 distance formula added. More investigation is needed.

##### 0.0.1

    + Initial

## Credits

Thanks to Leon Sorokin for information share and his original RGBQuant!

## References

- Palette Quantization Algorithms

  1.  [RGBQuant (Leon Sorokin)](https://github.com/leeoniya/RgbQuant.js) `JavaScript`
  2.  [NeuQuant (Johan Nordberg)](https://github.com/jnordberg/gif.js/blob/master/src/TypedNeuQuant.js) `TypeScript`
  3.  [NeuQuant (Tim Oxley)](https://github.com/timoxley/neuquant) `JavaScript`
  4.  [NeuQuant (Devon Govett)](https://github.com/devongovett/neuquant) `JavaScript`
  5.  [NeuQuant32 (Stuart Coyle)](https://github.com/stuart/pngnq/blob/master/src/neuquant32.c) `C`
  6.  [Xiaolin Wu (Xiaolin Wu)](http://www.ece.mcmaster.ca/~xwu/cq.c) `C`
  7.  [Xiaolin Wu (Smart-K8)](http://www.codeproject.com/Articles/66341/A-Simple-Yet-Quite-Powerful-Palette-Quantizer-in-C) `C#`
  8.  Xiaolin Wu w/ Alpha (Matt Wrock) [How to add Alpha](https://code.msdn.microsoft.com/windowsdesktop/Convert-32-bit-PNGs-to-81ef8c81/view/SourceCode#content), [Source Code](https://nquant.codeplex.com) `C#`
  9.  [MedianCut (mwcz)](https://github.com/mwcz/median-cut-js) `GPLv3`

- Image Quantization Algorithms

  1.  [All (ImageMagik doc)](http://www.imagemagick.org/Usage/quantize/#dither)
  2.  [Error Diffusion dithering (Tanner Helland)](http://www.tannerhelland.com/4660/dithering-eleven-algorithms-source-code)
  3.  [Riemersma dithering](http://www.compuphase.com/riemer.htm) `TODO: Check License`
  4.  [Ordered dithering (Joel Yliluoma)](http://bisqwit.iki.fi/story/howto/dither/jy)

- Color Distance Formulas

  [Calculator + Info](http://colorizer.org/)

  1.  Euclidean Distance
  2.  Manhattan Distance
  3.  CIE94 Distance
      - [Source Code (Iulius Curt)](https://github.com/iuliux/CIE94.js)
  4.  CIEDE2000
      - [Math and Test Data Table (PDF)](http://www.ece.rochester.edu/~gsharma/ciede2000/ciede2000noteCRNA.pdf)
      - [Info](http://www.ece.rochester.edu/~gsharma/ciede2000/)
      - [Source Code (Greg Fiumara)](https://github.com/gfiumara/CIEDE2000) `C`
      - [Source Code (THEjoezack)](https://github.com/THEjoezack/ColorMine/blob/master/ColorMine/ColorSpaces/Comparisons/CieDe2000Comparison.cs) `C#`
      - [Online Calculator](http://colormine.org/delta-e-calculator/cie2000)
  5.  Euclidean Distance w/o Alpha (RGBQuant)
  6.  Euclidean Distance w/o sRGB coefficients (Xiaolin Wu Quant)
  7.  Manhattan Distance w/o sRGB coefficients (NeuQuant)
  8.  [CMetric](http://www.compuphase.com/cmetric.htm) `DRAFT!`

- Color conversion formulas

  1.  [Pseudo-code](http://www.easyrgb.com/?X=MATH)

> Be sure to fix rgb2xyz/xyz2lab. Issue is with strange part of code: `r = r > 0.04045 ? ...`. Check http://en.wikipedia.org/wiki/Lab_color_space

- Image Quality Assessment

  1.  [SSIM info](http://en.wikipedia.org/wiki/Structural_similarity)
  2.  [SSIM (Rhys-e)](https://github.com/rhys-e/structural-similarity) `Java` `License: MIT`
  3.  PSNR ? TBD
  4.  MSE ? TBD

- Other

  1.  [HUSL (Boronine) - info](http://www.husl-colors.org)
  2.  [HUSL (Boronine) - code](https://github.com/husl-colors/husl)
  3.  [Color Image Quantization for Frame Buffer Display](https://www.cs.cmu.edu/~ph/ciq_thesis)
  4.  [K-Means](http://arxiv.org/pdf/1101.0395.pdf)
  5.  [Efficient Color Quantization by Hierarchical Clustering Algorithms](ftp://cs.joensuu.fi/pub/Theses/2005_MSc_Hautamaki_Ville.pdf)
  6.  http://www.codeproject.com/Articles/66341/A-Simple-Yet-Quite-Powerful-Palette-Quantizer-in-C

## License

[MIT](LICENSE)
