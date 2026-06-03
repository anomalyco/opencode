# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [1.0.11] -  2020-01-29
### Fixed
- Fix tests in node.js v12+, #179.


## [1.0.10] -  2019-02-28
### Fixed
- Fix minified version, #161.


## [1.0.9] - 2019-02-28
### Fixed
- Fix `new Buffer()` warning, #154.


## [1.0.8] - 2019-01-14
### Fixed
- Fix raw inflate with dictionary, #155.


## [1.0.7] - 2018-11-29
### Fixed
- Fixed RangeError in Crome 72, #150.


## [1.0.6] - 2017-09-14
### Changed
- Improve @std/esm compatibility.


## [1.0.5] - 2017-03-17
### Changed
- Maintenance. More formal `zlib` attribution and related
  changes, #93. Thanks to @bastien-roucaries for the help.


## [1.0.4] - 2016-12-15
### Changed
- Bump dev dependencies.

### Fixed
- Make sure `err.message` is filled on throw.

### Added
- Code examples for utf-16 string encoding & object compression.


## [1.0.3] - 2016-07-25
### Fixed
- Maintenance: re-release to properly display latest version in npm registry
  and badges. Because `npm publish` timestamp used instead of versions.


## [1.0.2] - 2016-07-21
### Fixed
- Fixed nasty bug in deflate (wrong `d_buf` offset), which could cause
  broken data in some rare cases.
- Also released as 0.2.9 to give chance to old dependents, not updated to 1.x
  version.


## [1.0.1] - 2016-04-01
### Added
- Added dictionary support. Thanks to @dignifiedquire.


## [1.0.0] - 2016-02-17
### Changed
- Maintenance release (semver, coding style).


## [0.2.8] - 2015-09-14
### Fixed
- Fixed regression after 0.2.4 for edge conditions in inflate wrapper (#65).
  Added more tests to cover possible cases.


## [0.2.7] - 2015-06-09
### Added
- Added Z_SYNC_FLUSH support. Thanks to @TinoLange.


## [0.2.6] - 2015-03-24
### Added
- Allow ArrayBuffer input.


## [0.2.5] - 2014-07-19
### Fixed
- Workaround for Chrome 38.0.2096.0 script parser bug, #30.


## [0.2.4] - 2014-07-07
### Fixed
- Fixed bug in inflate wrapper, #29


## [0.2.3] - 2014-06-09
### Changed
- Maintenance release, dependencies update.


## [0.2.2] - 2014-06-04
### Fixed
- Fixed iOS 5.1 Safari issue with `apply(typed_array)`, #26.


## [0.2.1] - 2014-05-01
### Fixed
- Fixed collision on switch dynamic/fixed tables.


## [0.2.0] - 2014-04-18
### Added
- Added custom gzip headers support.
- Added strings support.
- More coverage tests.

### Fixed
- Improved memory allocations for small chunks.
- ZStream properties rename/cleanup.


## [0.1.1] - 2014-03-20
### Fixed
- Bugfixes for inflate/deflate.


## [0.1.0] - 2014-03-15
### Added
- First release.


[1.0.10]: https://github.com/nodeca/pako/compare/1.0.10...1.0.11
[1.0.10]: https://github.com/nodeca/pako/compare/1.0.9...1.0.10
[1.0.9]: https://github.com/nodeca/pako/compare/1.0.8...1.0.9
[1.0.8]: https://github.com/nodeca/pako/compare/1.0.7...1.0.8
[1.0.7]: https://github.com/nodeca/pako/compare/1.0.6...1.0.7
[1.0.6]: https://github.com/nodeca/pako/compare/1.0.5...1.0.6
[1.0.5]: https://github.com/nodeca/pako/compare/1.0.4...1.0.5
[1.0.4]: https://github.com/nodeca/pako/compare/1.0.3...1.0.4
[1.0.3]: https://github.com/nodeca/pako/compare/1.0.2...1.0.3
[1.0.2]: https://github.com/nodeca/pako/compare/1.0.1...1.0.2
[1.0.1]: https://github.com/nodeca/pako/compare/1.0.0...1.0.1
[1.0.0]: https://github.com/nodeca/pako/compare/0.2.8...1.0.0
[0.2.8]: https://github.com/nodeca/pako/compare/0.2.7...0.2.8
[0.2.7]: https://github.com/nodeca/pako/compare/0.2.6...0.2.7
[0.2.6]: https://github.com/nodeca/pako/compare/0.2.5...0.2.6
[0.2.5]: https://github.com/nodeca/pako/compare/0.2.4...0.2.5
[0.2.4]: https://github.com/nodeca/pako/compare/0.2.3...0.2.4
[0.2.3]: https://github.com/nodeca/pako/compare/0.2.2...0.2.3
[0.2.2]: https://github.com/nodeca/pako/compare/0.2.1...0.2.2
[0.2.1]: https://github.com/nodeca/pako/compare/0.2.0...0.2.1
[0.2.0]: https://github.com/nodeca/pako/compare/0.1.1...0.2.0
[0.1.1]: https://github.com/nodeca/pako/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/nodeca/pako/releases/tag/0.1.0
