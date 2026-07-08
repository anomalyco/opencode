# Test262 String Coverage

The String tests adapt Test262 at revision `250f204f23a9249ff204be2baec29600faae7b75`. They cover CodeMode's 32
exposed instance methods and two static methods using primitive receivers, accepted argument types, and deterministic
behavior. Each executable case names its exact upstream source path. `LICENSE.test262` contains the upstream BSD terms.

This is coverage of CodeMode's bounded String surface, not a claim of ECMAScript or Test262 conformance. One upstream
file may contain both adapted and inapplicable assertions, so a cited source means only that the represented assertions
were adapted.

## Inventory

The relevant upstream directories contain 1,048 files: 1,009 core built-in files, 29 Annex B files for exposed methods,
and 10 Intl `localeCompare` files. The executable suite adapts assertions from 298 distinct sources.

| API | Upstream files | Adapted sources |
| --- | ---: | ---: |
| `String.fromCharCode` | 17 | 6 |
| `String.fromCodePoint` | 11 | 4 |
| `String.prototype.at` | 11 | 5 |
| `String.prototype.charAt` | 30 | 9 |
| `String.prototype.charCodeAt` | 25 | 4 |
| `String.prototype.codePointAt` | 16 | 6 |
| `String.prototype.concat` | 22 | 1 |
| `String.prototype.endsWith` | 27 | 13 |
| `String.prototype.includes` | 27 | 12 |
| `String.prototype.indexOf` | 47 | 8 |
| `String.prototype.lastIndexOf` | 25 | 1 |
| `String.prototype.localeCompare` | 23 | 1 |
| `String.prototype.match` | 52 | 9 |
| `String.prototype.matchAll` | 26 | 1 |
| `String.prototype.normalize` | 14 | 3 |
| `String.prototype.padEnd` | 13 | 4 |
| `String.prototype.padStart` | 13 | 4 |
| `String.prototype.repeat` | 16 | 4 |
| `String.prototype.replace` | 56 | 16 |
| `String.prototype.replaceAll` | 46 | 12 |
| `String.prototype.search` | 44 | 10 |
| `String.prototype.slice` | 38 | 11 |
| `String.prototype.split` | 121 | 50 |
| `String.prototype.startsWith` | 21 | 7 |
| `String.prototype.substr` | 15 | 6 |
| `String.prototype.substring` | 46 | 12 |
| `String.prototype.toLowerCase` | 30 | 5 |
| `String.prototype.toString` | 7 | 1 |
| `String.prototype.toUpperCase` | 26 | 3 |
| `String.prototype.trim` | 129 | 66 |
| `String.prototype.trimEnd` | 23 | 2 |
| `String.prototype.trimLeft` | 4 | 0 |
| `String.prototype.trimRight` | 4 | 0 |
| `String.prototype.trimStart` | 23 | 2 |

## Exclusions

Assertions are not adapted when they test behavior outside CodeMode's documented String surface:

- Function metadata, property descriptors, constructibility, prototype mutation, or cross-realm identity.
- The `trimLeft`/`trimRight` Test262 files assert prototype function identity, which CodeMode does not expose. Their
  supported call behavior remains covered by CodeMode-specific tests.
- Boxed strings, generic receivers, custom coercion objects, Symbols, BigInts, or argument types CodeMode rejects.
- Symbol-based RegExp dispatch, custom matchers, species constructors, or iterator protocol details. CodeMode materializes
  `matchAll` results instead of exposing iterators.
- Locale selection and options. CodeMode deliberately uses the host default locale and ignores those arguments.
- Test262 harness behavior or setup syntax unavailable in the confined interpreter.
- Function-replacer behavior that is covered by CodeMode-specific tests for sequential callbacks, async tool calls,
  result coercion, diagnostics, and sandbox boundaries.
- Assertions requiring an exact native error type when CodeMode deliberately exposes only its safe runtime error.

Handwritten tests remain where they specify CodeMode behavior rather than ordinary ECMAScript String semantics.
