---
title: Semver
description: Use Bun's semantic versioning API
---

Bun implements a semantic versioning API which can be used to compare versions and determine if a version is compatible with another range of versions. The versions and ranges are designed to be compatible with `node-semver`, which is used by npm clients.

It's about 20x faster than `node-semver`.

<Frame>![Benchmark](https://github.com/oven-sh/bun/assets/709451/94746adc-8aba-4baf-a143-3c355f8e0f78)</Frame>

Currently, this API provides two functions:

## `Bun.semver.satisfies(version: string, range: string): boolean`

Returns `true` if `version` satisfies `range`, otherwise `false`.

Example:

```typescript
import { semver } from "bun";

semver.satisfies("1.0.0", "^1.0.0"); // true
semver.satisfies("1.0.0", "^1.0.1"); // false
semver.satisfies("1.0.0", "~1.0.0"); // true
semver.satisfies("1.0.0", "~1.0.1"); // false
semver.satisfies("1.0.0", "1.0.0"); // true
semver.satisfies("1.0.0", "1.0.1"); // false
semver.satisfies("1.0.1", "1.0.0"); // false
semver.satisfies("1.0.0", "1.0.x"); // true
semver.satisfies("1.0.0", "1.x.x"); // true
semver.satisfies("1.0.0", "x.x.x"); // true
semver.satisfies("1.0.0", "1.0.0 - 2.0.0"); // true
semver.satisfies("1.0.0", "1.0.0 - 1.0.1"); // true
```

If `range` is invalid, it returns false. If `version` is invalid, it returns false.

## `Bun.semver.order(versionA: string, versionB: string): 0 | 1 | -1`

Returns `0` if `versionA` and `versionB` are equal, `1` if `versionA` is greater than `versionB`, and `-1` if `versionA` is less than `versionB`.

Example:

```typescript
import { semver } from "bun";

semver.order("1.0.0", "1.0.0"); // 0
semver.order("1.0.0", "1.0.1"); // -1
semver.order("1.0.1", "1.0.0"); // 1

const unsorted = ["1.0.0", "1.0.1", "1.0.0-alpha", "1.0.0-beta", "1.0.0-rc"];
unsorted.sort(semver.order); // ["1.0.0-alpha", "1.0.0-beta", "1.0.0-rc", "1.0.0", "1.0.1"]
console.log(unsorted);
```

If you need other semver functions, feel free to open an issue or pull request.
