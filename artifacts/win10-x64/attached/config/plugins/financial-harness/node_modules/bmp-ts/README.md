<div align="center">
  <img width="200" height="200"
    src="./logo.png">
  <h1>bmp-ts</h1>
  <p>A pure typescript <code>bmp</code> encoder and decoder.</p>
</div

[![Codecov](https://img.shields.io/codecov/c/github/hipstersmoothie/bmp-ts.svg?style=for-the-badge)](https://codecov.io/gh/hipstersmoothie/bmp-ts)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=for-the-badge)](https://github.com/prettier/prettier)

Supports decoding and encoding in all bit depths (1, 4, 8, 16, 24, 32).

## Install

```sh
npm install bmp-ts
```

## Usage

### Decoding

`decode` will return an object that includes all the header properties of the `bmp` image file and the data. See header definition [below](#header).

```js
const bmp = require('bmp-ts').default;
const bmpBuffer = fs.readFileSync('bit24.bmp');
const bmpData = bmp.decode(bmpBuffer);
```

#### Options

- toRGBA - switch the output to big endian RGBA, making it compatible with other libraries like `pngjs`

```js
const bmp = require('bmp-ts').default;
const bmpBuffer = fs.readFileSync('bit24.bmp');
const bmpData = bmp.decode(bmpBuffer, { toRGBA: true });
```

#### Supported Compression Methods

Currently compression is only supported during decoding. The following methods are implemented:

- NONE - Most common
- BI_RLE8 - Can be used only with 8-bit/pixel bitmap
- BI_RLE4 - Can be used only with 4-bit/pixel bitmaps
- BI_BIT_FIELDS - Huffman 1D - BITMAPV2INFOHEADER: RGB bit field masks, BITMAPV3INFOHEADER+: RGBA
- BI_ALPHA_BIT_FIELDS - RGBA bit field masks - only Windows CE 5.0 with .NET 4.0 or later

### Encoding

To encode an image all you need is a buffer with the image data, the height and the width. You can specify the bit depth of the output image by modifying `bitPP`. If you do not provide a value, the output image defaults to 24-bit.

All header fields are valid options to `encode` and will be encoded into the header.

```js
const bmp = require('bmp-ts').default;
const fs = require('fs');
const bmpData = {
  data, // Buffer
  bitPP: 1 | 2 | 4 | 16 | 24 | 32, // The number of bits per pixel
  width, // Number
  height, // Number
};

// Compression is not supported
const rawData = bmp.encode(bmpData);
fs.writeFileSync('./image.bmp', rawData.data);
```

## Header

| Property        | Type    | Purpose                                                                                                |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| fileSize        | number  | The size of the BMP file in bytes                                                                      |
| reserve1        | number  | Reserved; actual value depends on the application that creates the image                               |
| reserve2        | number  | Reserved; actual value depends on the application that creates the image                               |
| offset          | number  | The offset, i.e. starting address, of the byte where the bitmap image data (pixel array) can be found. |
| headerSize      | number  | The size of this header (12 bytes)                                                                     |
| width           | number  | The bitmap width in pixels (unsigned 16-bit)                                                           |
| height          | number  | The bitmap height in pixels (unsigned 16-bit)                                                          |
| planes          | number  | The number of color planes, must be 1                                                                  |
| bitPP           | number  | The number of bits per pixel                                                                           |
| compress        | number  | The compression method being used. See the supported compression methods                               |
| rawSize         | number  | The image size. This is the size of the raw bitmap data; a dummy 0 can be given for BI_RGB bitmaps.    |
| hr              | number  | The horizontal resolution of the image. (pixel per metre, signed integer)                              |
| vr              | number  | The vertical resolution of the image. (pixel per metre, signed integer)                                |
| colors          | number  | The number of colors in the color palette, or 0 to default to 2n                                       |
| importantColors | number  | The number of important colors used, or 0 when every color is important; generally ignored             |
| palette         | Color[] | The colors used to render the image. only used for 1, 4, and 8 bitPP images                            |
| data            | Byte[]  | The data in ABGR                                                                                       |

### Color

The color palette is returned when decoding a 1, 4, or 8 bit image.

Color Format:

```json
{
  "red": 255,
  "green": 255,
  "blue": 255,
  "quad": 255
}
```

To encode to 4 or 8 bit a color palette must be provided. 1 bit defaults to black and white but you can override this via palette.

```js
const rawData = bmp.encode({
  data,
  bitPP: 8,
  width,
  height,
  palette: [
    { red: 255, green: 255, blue: 255, quad: 0 },
    { red: 255, green: 255, blue: 0, quad: 0 },
    { red: 255, green: 0, blue: 255, quad: 0 },
    { red: 255, green: 0, blue: 0, quad: 0 },
    { red: 0, green: 255, blue: 255, quad: 0 },
    { red: 0, green: 255, blue: 0, quad: 0 },
    { red: 0, green: 0, blue: 255, quad: 0 },
    { red: 0, green: 0, blue: 0, quad: 0 },
  ],
});

fs.writeFileSync('./image.bmp', rawData.data);
```
