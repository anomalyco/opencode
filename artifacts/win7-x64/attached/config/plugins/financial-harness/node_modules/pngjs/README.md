![build](https://github.com/pngjs/pngjs/actions/workflows/ci.yml/badge.svg?branch=main) [![codecov](https://codecov.io/gh/pngjs/pngjs/branch/master/graph/badge.svg)](https://codecov.io/gh/pngjs/pngjs) [![npm version](https://badge.fury.io/js/pngjs.svg)](http://badge.fury.io/js/pngjs)

# pngjs

Simple PNG encoder/decoder for Node.js with no dependencies.

Based on the original [pngjs](https://github.com/niegowski/node-pngjs) with the follow enhancements.

- Support for reading 1,2,4 & 16 bit files
- Support for reading interlace files
- Support for reading `tTRNS` transparent colours
- Support for writing colortype 0 (grayscale), colortype 2 (RGB), colortype 4 (grayscale alpha) and colortype 6 (RGBA)
- Sync interface as well as async
- API compatible with pngjs and node-pngjs

Known lack of support for:

- Extended PNG e.g. Animation
- Writing in colortype 3 (indexed color)

# Table of Contents

- [Requirements](#requirements)
- [Comparison Table](#comparison-table)
- [Tests](#tests)
- [Installation](#installation)
- [Browser](#browser)
- [Example](#example)
- [Async API](#async-api)
- [Sync API](#sync-api)
- [Changelog](#changelog)

# Comparison Table

| Name          | Forked From | Sync | Async | 16 Bit | 1/2/4 Bit | Interlace | Gamma  | Encodes | Tested |
| ------------- | ----------- | ---- | ----- | ------ | --------- | --------- | ------ | ------- | ------ |
| pngjs         |             | Yes  | Yes   | Yes    | Yes       | Yes       | Yes    | Yes     | Yes    |
| node-png      | pngjs       | No   | Yes   | No     | No        | No        | Hidden | Yes     | Manual |
| png-coder     | pngjs       | No   | Yes   | Yes    | No        | No        | Hidden | Yes     | Manual |
| pngparse      |             | No   | Yes   | No     | Yes       | No        | No     | No      | Yes    |
| pngparse-sync | pngparse    | Yes  | No    | No     | Yes       | No        | No     | No      | Yes    |
| png-async     |             | No   | Yes   | No     | No        | No        | No     | Yes     | Yes    |
| png-js        |             | No   | Yes   | No     | No        | No        | No     | No      | No     |

Native C++ node decoders:

- png
- png-sync (sync version of above)
- pixel-png
- png-img

# Tests

Tested using [PNG Suite](http://www.schaik.com/pngsuite/). We read every file into pngjs, output it in standard 8bit colour, synchronously and asynchronously, then compare the original with the newly saved images.

To run the tests, fetch the repo (tests are not distributed via npm) and install with `npm i`, run `npm test`.

The only thing not converted is gamma correction - this is because multiple vendors will do gamma correction differently, so the tests will have different results on different browsers.

# Installation

```
$ npm install pngjs  --save
```

# Browser

The package has been build with a [Browserify](browserify.org) version (`npm run browserify`) and you can use the browser version by including in your code:

```
import { PNG } from 'pngjs/browser';
```

# Example

```js
var fs = require("fs"),
  PNG = require("pngjs").PNG;

fs.createReadStream("in.png")
  .pipe(
    new PNG({
      filterType: 4,
    })
  )
  .on("parsed", function () {
    for (var y = 0; y < this.height; y++) {
      for (var x = 0; x < this.width; x++) {
        var idx = (this.width * y + x) << 2;

        // invert color
        this.data[idx] = 255 - this.data[idx];
        this.data[idx + 1] = 255 - this.data[idx + 1];
        this.data[idx + 2] = 255 - this.data[idx + 2];

        // and reduce opacity
        this.data[idx + 3] = this.data[idx + 3] >> 1;
      }
    }

    this.pack().pipe(fs.createWriteStream("out.png"));
  });
```

For more examples see `examples` folder.

# Async API

As input any color type is accepted (grayscale, rgb, palette, grayscale with alpha, rgb with alpha) but 8 bit per sample (channel) is the only supported bit depth. Interlaced mode is not supported.

## Class: PNG

`PNG` is readable and writable `Stream`.

### Options

- `width` - use this with `height` if you want to create png from scratch
- `height` - as above
- `checkCRC` - whether parser should be strict about checksums in source stream (default: `true`)
- `deflateChunkSize` - chunk size used for deflating data chunks, this should be power of 2 and must not be less than 256 and more than 32\*1024 (default: 32 kB)
- `deflateLevel` - compression level for deflate (default: 9)
- `deflateStrategy` - compression strategy for deflate (default: 3)
- `deflateFactory` - deflate stream factory (default: `zlib.createDeflate`)
- `filterType` - png filtering method for scanlines (default: -1 => auto, accepts array of numbers 0-4)
- `colorType` - the output colorType - see constants. 0 = grayscale, no alpha, 2 = color, no alpha, 4 = grayscale & alpha, 6 = color & alpha. Default currently 6, but in the future may calculate best mode.
- `inputColorType` - the input colorType - see constants. Default is 6 (RGBA)
- `bitDepth` - the bitDepth of the output, 8 or 16 bits. Input data is expected to have this bit depth.
  16 bit data is expected in the system endianness (Default: 8)
- `inputHasAlpha` - whether the input bitmap has 4 bytes per pixel (rgb and alpha) or 3 (rgb - no alpha).
- `bgColor` - an object containing red, green, and blue values between 0 and 255
  that is used when packing a PNG if alpha is not to be included (default: 255,255,255)

### Event "metadata"

`function(metadata) { }`
Image's header has been parsed, metadata contains this information:

- `width` image size in pixels
- `height` image size in pixels
- `palette` image is paletted
- `color` image is not grayscale
- `alpha` image contains alpha channel
- `interlace` image is interlaced

### Event: "parsed"

`function(data) { }`
Input image has been completely parsed, `data` is complete and ready for modification.

### Event: "error"

`function(error) { }`

### png.parse(data, [callback])

Parses PNG file data. Can be `String` or `Buffer`. Alternatively you can stream data to instance of PNG.

Optional `callback` is once called on `error` or `parsed`. The callback gets
two arguments `(err, data)`.

Returns `this` for method chaining.

#### Example

```js
new PNG({ filterType: 4 }).parse(imageData, function (error, data) {
  console.log(error, data);
});
```

### png.pack()

Starts converting data to PNG file Stream.

Returns `this` for method chaining.

### png.bitblt(dst, sx, sy, w, h, dx, dy)

Helper for image manipulation, copies a rectangle of pixels from current (i.e. the source) image (`sx`, `sy`, `w`, `h`) to `dst` image (at `dx`, `dy`).

Returns `this` for method chaining.

For example, the following code copies the top-left 100x50 px of `in.png` into dst and writes it to `out.png`:

```js
var dst = new PNG({ width: 100, height: 50 });
fs.createReadStream("in.png")
  .pipe(new PNG())
  .on("parsed", function () {
    this.bitblt(dst, 0, 0, 100, 50, 0, 0);
    dst.pack().pipe(fs.createWriteStream("out.png"));
  });
```

### Property: adjustGamma()

Helper that takes data and adjusts it to be gamma corrected. Note that it is not 100% reliable with transparent colours because that requires knowing the background colour the bitmap is rendered on to.

In tests against PNG suite it compared 100% with chrome on all 8 bit and below images. On IE there were some differences.

The following example reads a file, adjusts the gamma (which sets the gamma to 0) and writes it out again, effectively removing any gamma correction from the image.

```js
fs.createReadStream("in.png")
  .pipe(new PNG())
  .on("parsed", function () {
    this.adjustGamma();
    this.pack().pipe(fs.createWriteStream("out.png"));
  });
```

### Property: width

Width of image in pixels

### Property: height

Height of image in pixels

### Property: data

Buffer of image pixel data. Every pixel consists 4 bytes: R, G, B, A (opacity).

### Property: gamma

Gamma of image (0 if not specified)

## Packing a PNG and removing alpha (RGBA to RGB)

When removing the alpha channel from an image, there needs to be a background color to correctly
convert each pixel's transparency to the appropriate RGB value. By default, pngjs will flatten
the image against a white background. You can override this in the options:

```js
var fs = require("fs"),
  PNG = require("pngjs").PNG;

fs.createReadStream("in.png")
  .pipe(
    new PNG({
      colorType: 2,
      bgColor: {
        red: 0,
        green: 255,
        blue: 0,
      },
    })
  )
  .on("parsed", function () {
    this.pack().pipe(fs.createWriteStream("out.png"));
  });
```

# Sync API

## PNG.sync

### PNG.sync.read(buffer)

Take a buffer and returns a PNG image. The properties on the image include the meta data and `data` as per the async API above.

```
var data = fs.readFileSync('in.png');
var png = PNG.sync.read(data);
```

### PNG.sync.write(png)

Take a PNG image and returns a buffer. The properties on the image include the meta data and `data` as per the async API above.

```
var data = fs.readFileSync('in.png');
var png = PNG.sync.read(data);
var options = { colorType: 6 };
var buffer = PNG.sync.write(png, options);
fs.writeFileSync('out.png', buffer);
```

### PNG.adjustGamma(src)

Adjusts the gamma of a sync image. See the async adjustGamma.

```
var data = fs.readFileSync('in.png');
var png = PNG.sync.read(data);
PNG.adjustGamma(png);
```
