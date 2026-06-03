# Changelog

### 7.0.0 - 19/02/2023

- BREAKING - Drop support for node 12 (Though nothing incompatible in this release yet)
- Switch to a pngjs organisation

### 6.0.0 - 24/10/2020

- BREAKING - Sync version now throws if there is unexpected content at the end of the stream.
- BREAKING - Drop support for node 10 (Though nothing incompatible in this release yet)
- Reduce the number of files included in the package

### 5.1.0 - 13/09/2020

- Add option to skip rescaling

### 5.0.0 - 15/04/2020

- Drop support for Node 8
- Browserified bundle may now contain ES20(15-20) code if the supported node version supports it. Please run the browserified version through babel if you need to support older browsers.

### 4.0.1 - 15/04/2020

- Fix to possible null reference in nextTick of async method

### 4.0.0 - 09/04/2020

- Fix issue in newer nodes with using Buffer
- Fix async issue with some png files
- Drop support for Node 4 & 6

### 3.4.0 - 09/03/2019

- Include whether the png has alpha in the meta data
- emit an error if the image is truncated instead of hanging
- Add a browserified version
- speed up some mapping functions

### 3.3.3 - 19/04/2018

- Real fix for node 9

### 3.3.2 - 16/02/2018

- Fix for node 9

### 3.3.1 - 15/11/2017

- Bugfixes and removal of es6

### 3.3.0

- Add writing 16 bit channels and support for grayscale input

### 3.2.0 - 30/04/2017

- Support for encoding 8-bit grayscale images

### 3.1.0 - 30/04/2017

- Support for pngs with zlib chunks that are malformed after valid data

### 3.0.1 - 16/02/2017

- Fix single pixel pngs

### 3.0.0 - 03/08/2016

- Drop support for node below v4 and iojs. Pin to 2.3.0 to use with old, unsupported or patched node versions.

### 2.3.0 - 22/04/2016

- Support for sync in node 0.10

### 2.2.0 - 04/12/2015

- Add sync write api
- Fix newfile example
- Correct comparison table

### 2.1.0 - 28/10/2015

- rename package to pngjs
- added 'bgColor' option

### 2.0.0 - 08/10/2015

- fixes to readme
- _breaking change_ - bitblt on the png prototype now doesn't take a unused, unnecessary src first argument

### 1.2.0 - 13/09/2015

- support passing colorType to write PNG's and writing bitmaps without alpha information

### 1.1.0 - 07/09/2015

- support passing a deflate factory for controlled compression

### 1.0.2 - 22/08/2015

- Expose all PNG creation info

### 1.0.1 - 21/08/2015

- Fix non square interlaced files

### 1.0.0 - 08/08/2015

- More tests
- source linted
- maintainability refactorings
- async API - exceptions in reading now emit warnings
- documentation improvement - sync api now documented, adjustGamma documented
- breaking change - gamma chunk is now written. previously a read then write would destroy gamma information, now it is persisted.

### 0.0.3 - 03/08/2015

- Error handling fixes
- ignore files for smaller npm footprint

### 0.0.2 - 02/08/2015

- Bugfixes to interlacing, support for transparent colours

### 0.0.1 - 02/08/2015

- Initial release, see pngjs for older changelog.
