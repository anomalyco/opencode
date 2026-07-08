# Test262 Array Coverage

The Array tests adapt Test262 at revision `250f204f23a9249ff204be2baec29600faae7b75`. They cover CodeMode's 35
exposed instance methods and three static methods using actual arrays, accepted argument types, deterministic behavior,
and CodeMode's materialized collection conventions. Each executable case names its exact upstream source path.
`LICENSE.test262` contains the upstream BSD terms.

This is coverage of CodeMode's bounded Array surface, not a claim of ECMAScript or Test262 conformance. One upstream
file may contain both adapted and inapplicable assertions, so a cited source means only that the represented assertions
were adapted.

## Inventory

The 38 relevant upstream API directories contain 2,837 files. The executable suite adapts assertions from 83 distinct
sources.

| API                             | Upstream files | Adapted sources |
| ------------------------------- | -------------: | --------------: |
| `Array.prototype.map`           |            216 |               3 |
| `Array.prototype.filter`        |            242 |               3 |
| `Array.prototype.find`          |             23 |               4 |
| `Array.prototype.findIndex`     |             23 |               3 |
| `Array.prototype.findLast`      |             24 |               3 |
| `Array.prototype.findLastIndex` |             24 |               3 |
| `Array.prototype.some`          |            219 |               2 |
| `Array.prototype.every`         |            218 |               2 |
| `Array.prototype.includes`      |             30 |               2 |
| `Array.prototype.join`          |             23 |               2 |
| `Array.prototype.reduce`        |            260 |               3 |
| `Array.prototype.reduceRight`   |            260 |               3 |
| `Array.prototype.flatMap`       |             24 |               2 |
| `Array.prototype.forEach`       |            190 |               2 |
| `Array.prototype.sort`          |             54 |               3 |
| `Array.prototype.toSorted`      |             21 |               4 |
| `Array.prototype.slice`         |             71 |               1 |
| `Array.prototype.concat`        |             69 |               3 |
| `Array.prototype.indexOf`       |            201 |               2 |
| `Array.prototype.lastIndexOf`   |            198 |               2 |
| `Array.prototype.at`            |             13 |               3 |
| `Array.prototype.flat`          |             19 |               2 |
| `Array.prototype.reverse`       |             18 |               1 |
| `Array.prototype.toReversed`    |             17 |               2 |
| `Array.prototype.with`          |             21 |               2 |
| `Array.prototype.push`          |             24 |               1 |
| `Array.prototype.pop`           |             23 |               1 |
| `Array.prototype.shift`         |             20 |               1 |
| `Array.prototype.unshift`       |             22 |               1 |
| `Array.prototype.splice`        |             81 |               3 |
| `Array.prototype.fill`          |             22 |               3 |
| `Array.prototype.copyWithin`    |             39 |               2 |
| `Array.prototype.keys`          |             12 |               1 |
| `Array.prototype.values`        |             12 |               1 |
| `Array.prototype.entries`       |             12 |               1 |
| `Array.from`                    |             47 |               3 |
| `Array.isArray`                 |             29 |               2 |
| `Array.of`                      |             16 |               1 |

## Exclusions

Assertions are not adapted when they test behavior outside CodeMode's documented Array surface:

- Function metadata, property descriptors, constructibility, prototype mutation, species constructors, or cross-realm
  identity.
- Generic receivers, detached methods, `.call`, `.apply`, boxed values, custom coercion objects, Symbols, BigInts,
  proxies, accessors, frozen arrays, typed arrays, or ArrayBuffers.
- `Array.from` mappers, custom iterables, constructor substitution, and iterator-closing behavior.
- Native iterator identity, `.next()`, completion records, or live iterator mutation. CodeMode deliberately materializes
  `keys`, `values`, and `entries` as arrays.
- Sparse-array assertions that depend on literal elisions or inherited indexed properties. CodeMode's confined data
  model does not preserve those prototype and hole semantics at every boundary.
- Argument coercions outside the accepted schema-like surface. Numeric positions must be numbers and `join` separators
  must be strings.
- Exact native error brands where CodeMode exposes a safe runtime error instead.
- Async/effectful callbacks, circular-data rejection, sandbox-value identity, diagnostics, and host-boundary behavior.
  Those remain covered by CodeMode-specific tests.

Handwritten tests remain where they specify CodeMode behavior rather than ordinary ECMAScript Array semantics.
