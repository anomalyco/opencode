/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/built-ins/Array/prototype/includes/samevaluezero.js
 * - test/built-ins/Array/prototype/includes/using-fromindex.js
 * - test/built-ins/Array/prototype/join/S15.4.4.5_A3.1_T1.js
 * - test/built-ins/Array/prototype/join/S15.4.4.5_A3.2_T1.js
 * - test/built-ins/Array/prototype/slice/S15.4.4.10_A1.2_T2.js
 * - test/built-ins/Array/prototype/concat/S15.4.4.4_A1_T1.js
 * - test/built-ins/Array/prototype/concat/S15.4.4.4_A1_T2.js
 * - test/built-ins/Array/prototype/concat/S15.4.4.4_A1_T3.js
 * - test/built-ins/Array/prototype/indexOf/fromindex-zero-conversion.js
 * - test/built-ins/Array/prototype/indexOf/length-zero-returns-minus-one.js
 * - test/built-ins/Array/prototype/lastIndexOf/fromindex-zero-conversion.js
 * - test/built-ins/Array/prototype/lastIndexOf/length-zero-returns-minus-one.js
 * - test/built-ins/Array/prototype/at/returns-item.js
 * - test/built-ins/Array/prototype/at/returns-item-relative-index.js
 * - test/built-ins/Array/prototype/at/returns-undefined-for-out-of-range-index.js
 * - test/built-ins/Array/prototype/flat/null-undefined-elements.js
 * - test/built-ins/Array/prototype/flat/positive-infinity.js
 * - test/built-ins/Array/prototype/reverse/S15.4.4.8_A1_T1.js
 * - test/built-ins/Array/prototype/toReversed/immutable.js
 * - test/built-ins/Array/prototype/toReversed/zero-or-one-element.js
 * - test/built-ins/Array/prototype/with/immutable.js
 * - test/built-ins/Array/prototype/with/index-negative.js
 * - test/built-ins/Array/prototype/push/S15.4.4.7_A1_T1.js
 * - test/built-ins/Array/prototype/pop/S15.4.4.6_A1.1_T1.js
 * - test/built-ins/Array/prototype/shift/S15.4.4.9_A1.1_T1.js
 * - test/built-ins/Array/prototype/unshift/S15.4.4.13_A1_T1.js
 * - test/built-ins/Array/prototype/splice/S15.4.4.12_A1.1_T1.js
 * - test/built-ins/Array/prototype/splice/S15.4.4.12_A1.2_T1.js
 * - test/built-ins/Array/prototype/splice/called_with_one_argument.js
 * - test/built-ins/Array/prototype/fill/fill-values.js
 * - test/built-ins/Array/prototype/fill/fill-values-custom-start-and-end.js
 * - test/built-ins/Array/prototype/fill/return-this.js
 * - test/built-ins/Array/prototype/copyWithin/non-negative-target-start-and-end.js
 * - test/built-ins/Array/prototype/copyWithin/return-this.js
 * - test/built-ins/Array/prototype/keys/iteration.js
 * - test/built-ins/Array/prototype/values/iteration.js
 * - test/built-ins/Array/prototype/entries/iteration.js
 * - test/built-ins/Array/isArray/15.4.3.2-0-3.js
 * - test/built-ins/Array/isArray/15.4.3.2-0-4.js
 * - test/built-ins/Array/from/from-array.js
 * - test/built-ins/Array/from/from-string.js
 * - test/built-ins/Array/from/array-like-has-length-but-no-indexes-with-values.js
 * - test/built-ins/Array/of/creates-a-new-array-from-arguments.js
 *
 * Copyright (C) 2015 André Bargull. All rights reserved.
 * Copyright (C) 2015 the V8 project authors. All rights reserved.
 * Copyright (C) 2016 the V8 project authors. All rights reserved.
 * Copyright (C) 2018 Shilpi Jain and Michael Ficarra. All rights reserved.
 * Copyright (C) 2020 Alexey Shvayka. All rights reserved.
 * Copyright (C) 2020 Rick Waldron. All rights reserved.
 * Copyright (C) 2021 Igalia, S.L. All rights reserved.
 * Copyright (c) 2012 Ecma International.  All rights reserved.
 * Copyright (c) 2014 Hank Yates. All rights reserved.
 * Copyright (c) 2015 the V8 project authors. All rights reserved.
 * Copyright (c) 2021 Rick Waldron.  All rights reserved.
 * Copyright 2009 the Sputnik authors.  All rights reserved.
 * Copyright 2015 Microsoft Corporation. All rights reserved.
 * Copyright 2016 The V8 project authors. All rights reserved.
 * Test262 portions are governed by the BSD license in LICENSE.test262.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../src/index.js"

const value = async (code: string) => {
  const result = await Effect.runPromise(CodeMode.execute({ code, tools: {} }))
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

const cases = [
  {
    path: "test/built-ins/Array/prototype/includes/samevaluezero.js",
    code: `const input = [42, 0, 1, NaN]; return [input.includes(42), input.includes("42"), input.includes([42]), input.includes(true), input.includes(NaN), input.includes(0), input.includes(-0), input.includes(null), input.includes("")]`,
    expected: [true, false, false, false, true, true, true, false, false],
  },
  {
    path: "test/built-ins/Array/prototype/includes/using-fromindex.js",
    code: `const input = ["a", "b", "c"]; return [input.includes("a", 0), input.includes("a", 1), input.includes("a", -4), input.includes("a", -3), input.includes("a", -2), input.includes("b", 0), input.includes("b", 1), input.includes("b", 2), input.includes("b", -3), input.includes("b", -2), input.includes("b", -1), input.includes("c", 0), input.includes("c", 2), input.includes("c", 3), input.includes("c", -3), input.includes("c", -1)]`,
    expected: [true, false, true, true, false, true, true, false, true, true, false, true, true, false, true, true],
  },
  {
    path: "test/built-ins/Array/prototype/join/S15.4.4.5_A3.1_T1.js",
    code: `return [[0, 1, 2, 3].join("&"), [0, 1, 2, 3].join("")]`,
    expected: ["0&1&2&3", "0123"],
  },
  {
    path: "test/built-ins/Array/prototype/join/S15.4.4.5_A3.2_T1.js",
    code: `return [
      ["", "", ""].join(""),
      ["&", "&", "&"].join("&"),
      [true, true, true].join(),
      [null, null, null].join(),
      [undefined, undefined, undefined].join(),
      [Infinity, Infinity, Infinity].join(),
      [NaN, NaN, NaN].join(),
    ]`,
    expected: ["", "&&&&&", "true,true,true", ",,", ",,", "Infinity,Infinity,Infinity", "NaN,NaN,NaN"],
  },
  {
    path: "test/built-ins/Array/prototype/slice/S15.4.4.10_A1.2_T2.js",
    code: `return [0, 1, 2, 3, 4].slice(-1, 5)`,
    expected: [4],
  },
  {
    path: "test/built-ins/Array/prototype/concat/S15.4.4.4_A1_T1.js",
    code: `return [].concat([0, 1], [2, 3, 4])`,
    expected: [0, 1, 2, 3, 4],
  },
  {
    path: "test/built-ins/Array/prototype/concat/S15.4.4.4_A1_T2.js",
    code: `const object = { value: 1 }; const result = [0].concat(object, [1, 2], -1, true, "NaN"); return [result, result[1] === object]`,
    expected: [[0, { value: 1 }, 1, 2, -1, true, "NaN"], true],
  },
  {
    path: "test/built-ins/Array/prototype/concat/S15.4.4.4_A1_T3.js",
    code: `const input = [0, 1]; const result = input.concat(); return [result, result !== input]`,
    expected: [[0, 1], true],
  },
  {
    path: "test/built-ins/Array/prototype/indexOf/fromindex-zero-conversion.js",
    code: `const result = [true].indexOf(true, -0); return [result, 1 / result === Infinity]`,
    expected: [0, true],
  },
  {
    path: "test/built-ins/Array/prototype/indexOf/length-zero-returns-minus-one.js",
    code: `return [].indexOf(1)`,
    expected: -1,
  },
  {
    path: "test/built-ins/Array/prototype/lastIndexOf/fromindex-zero-conversion.js",
    code: `const result = [true].lastIndexOf(true, -0); return [result, 1 / result === Infinity]`,
    expected: [0, true],
  },
  {
    path: "test/built-ins/Array/prototype/lastIndexOf/length-zero-returns-minus-one.js",
    code: `return [].lastIndexOf(1)`,
    expected: -1,
  },
  {
    path: "test/built-ins/Array/prototype/at/returns-item.js",
    code: `const input = [1, 2, 3, 4, undefined, 5]; return [input.at(0), input.at(1), input.at(2), input.at(3), input.at(4) === undefined, input.at(5)]`,
    expected: [1, 2, 3, 4, true, 5],
  },
  {
    path: "test/built-ins/Array/prototype/at/returns-item-relative-index.js",
    code: `const input = [1, 2, 3, 4, undefined, 5]; return [input.at(0), input.at(-1), input.at(-2) === undefined, input.at(-3), input.at(-4)]`,
    expected: [1, 5, true, 4, 3],
  },
  {
    path: "test/built-ins/Array/prototype/at/returns-undefined-for-out-of-range-index.js",
    code: `const input = []; return [input.at(-2) === undefined, input.at(0) === undefined, input.at(1) === undefined]`,
    expected: [true, true, true],
  },
  {
    path: "test/built-ins/Array/prototype/flat/null-undefined-elements.js",
    code: `const result = [1, [null, [undefined]]].flat(2); return [result.length, result[0], result[1] === null, result[2] === undefined]`,
    expected: [3, 1, true, true],
  },
  {
    path: "test/built-ins/Array/prototype/flat/positive-infinity.js",
    code: `return [1, [2, [3, [4]]]].flat(Infinity)`,
    expected: [1, 2, 3, 4],
  },
  {
    path: "test/built-ins/Array/prototype/reverse/S15.4.4.8_A1_T1.js",
    code: `const empty = []; const one = [1]; const input = [1, 2]; const emptyResult = empty.reverse(); const oneResult = one.reverse(); const result = input.reverse(); return [emptyResult === empty, oneResult === one, result === input, input]`,
    expected: [true, true, true, [2, 1]],
  },
  {
    path: "test/built-ins/Array/prototype/toReversed/immutable.js",
    code: `const input = [0, 1, 2]; const result = input.toReversed(); return [input, result !== input]`,
    expected: [[0, 1, 2], true],
  },
  {
    path: "test/built-ins/Array/prototype/toReversed/zero-or-one-element.js",
    code: `const zero = []; const one = [1]; const zeroResult = zero.toReversed(); const oneResult = one.toReversed(); return [zeroResult, oneResult, zeroResult !== zero, oneResult !== one]`,
    expected: [[], [1], true, true],
  },
  {
    path: "test/built-ins/Array/prototype/with/immutable.js",
    code: `const input = [0, 1, 2]; const result = input.with(1, 3); return [input, result !== input, input.with(1, 1) !== input]`,
    expected: [[0, 1, 2], true, true],
  },
  {
    path: "test/built-ins/Array/prototype/with/index-negative.js",
    code: `const input = [0, 1, 2]; return [input.with(-1, 4), input.with(-3, 4)]`,
    expected: [
      [0, 1, 4],
      [4, 1, 2],
    ],
  },
  {
    path: "test/built-ins/Array/prototype/push/S15.4.4.7_A1_T1.js",
    code: `const input = []; return [input.push(1), input.push(), input.push(-1), input]`,
    expected: [1, 1, 2, [1, -1]],
  },
  {
    path: "test/built-ins/Array/prototype/pop/S15.4.4.6_A1.1_T1.js",
    code: `const input = []; return [input.pop() === undefined, input.length]`,
    expected: [true, 0],
  },
  {
    path: "test/built-ins/Array/prototype/shift/S15.4.4.9_A1.1_T1.js",
    code: `const input = []; return [input.shift() === undefined, input.length]`,
    expected: [true, 0],
  },
  {
    path: "test/built-ins/Array/prototype/unshift/S15.4.4.13_A1_T1.js",
    code: `const input = []; return [input.unshift(1), input[0], input.unshift(), input.unshift(-1), input]`,
    expected: [1, 1, 1, 2, [-1, 1]],
  },
  {
    path: "test/built-ins/Array/prototype/splice/S15.4.4.12_A1.1_T1.js",
    code: `const input = [0, 1, 2, 3]; const removed = input.splice(0, 3); return [input, removed]`,
    expected: [[3], [0, 1, 2]],
  },
  {
    path: "test/built-ins/Array/prototype/splice/S15.4.4.12_A1.2_T1.js",
    code: `const input = [0, 1]; const removed = input.splice(-2, -1); return [input, removed]`,
    expected: [[0, 1], []],
  },
  {
    path: "test/built-ins/Array/prototype/splice/called_with_one_argument.js",
    code: `const input = ["first", "second", "third"]; const removed = input.splice(1); return [input, removed]`,
    expected: [["first"], ["second", "third"]],
  },
  {
    path: "test/built-ins/Array/prototype/fill/fill-values-custom-start-and-end.js",
    code: `const input = [0, 0, 0, 0, 0]; input.fill(8, -3, 4); const sparse = []; sparse[4] = 0; sparse.fill(8, 1, 3); return [[0, 0, 0].fill(8, 1, 2), input, [0, 0, 0, 0, 0].fill(8, -2, -1), [0, 0, 0, 0, 0].fill(8, -1, -3), [0 in sparse, sparse[1], sparse[2], 3 in sparse, sparse[4]]]`,
    expected: [
      [0, 8, 0],
      [0, 0, 8, 8, 0],
      [0, 0, 0, 8, 0],
      [0, 0, 0, 0, 0],
      [false, 8, 8, false, 0],
    ],
  },
  {
    path: "test/built-ins/Array/prototype/fill/return-this.js",
    code: `const input = []; return input.fill(1) === input`,
    expected: true,
  },
  {
    path: "test/built-ins/Array/prototype/fill/fill-values.js",
    code: `const omitted = [0, 0].fill(); return [[].fill(8), omitted.map((value) => value === undefined), [0, 0, 0].fill(8)]`,
    expected: [[], [true, true], [8, 8, 8]],
  },
  {
    path: "test/built-ins/Array/prototype/copyWithin/non-negative-target-start-and-end.js",
    code: `return [[0, 1, 2, 3].copyWithin(0, 0, 0), [0, 1, 2, 3].copyWithin(0, 0, 2), [0, 1, 2, 3].copyWithin(0, 1, 2), [0, 1, 2, 3].copyWithin(1, 0, 2), [0, 1, 2, 3, 4, 5].copyWithin(1, 3, 5)]`,
    expected: [
      [0, 1, 2, 3],
      [0, 1, 2, 3],
      [1, 1, 2, 3],
      [0, 0, 1, 3],
      [0, 3, 4, 3, 4, 5],
    ],
  },
  {
    path: "test/built-ins/Array/prototype/copyWithin/return-this.js",
    code: `const input = [0, 1, 2, 3]; const result = input.copyWithin(1, 0, 2); return [input, result === input]`,
    expected: [[0, 0, 1, 3], true],
  },
  {
    path: "test/built-ins/Array/prototype/keys/iteration.js",
    code: `return ["a", "b", "c"].keys()`,
    expected: [0, 1, 2],
  },
  {
    path: "test/built-ins/Array/prototype/values/iteration.js",
    code: `return ["a", "b", "c"].values()`,
    expected: ["a", "b", "c"],
  },
  {
    path: "test/built-ins/Array/prototype/entries/iteration.js",
    code: `return ["a", "b"].entries()`,
    expected: [
      [0, "a"],
      [1, "b"],
    ],
  },
  {
    path: "test/built-ins/Array/isArray/15.4.3.2-0-3.js",
    code: `return [Array.isArray([]), Array.isArray([1]), Array.isArray(Array.of(1))]`,
    expected: [true, true, true],
  },
  {
    path: "test/built-ins/Array/isArray/15.4.3.2-0-4.js",
    code: `return [Array.isArray(42), Array.isArray({}), Array.isArray(null), Array.isArray("array")]`,
    expected: [false, false, false, false],
  },
  {
    path: "test/built-ins/Array/from/from-array.js",
    code: `const input = [0, "foo", undefined, Infinity]; const result = Array.from(input); return [result.length, result[0], result[1], result[2] === undefined, result[3] === Infinity, result !== input, result instanceof Array]`,
    expected: [4, 0, "foo", true, true, true, true],
  },
  {
    path: "test/built-ins/Array/from/from-string.js",
    code: `return Array.from("Test")`,
    expected: ["T", "e", "s", "t"],
  },
  {
    path: "test/built-ins/Array/from/array-like-has-length-but-no-indexes-with-values.js",
    code: `const result = Array.from({ length: 5 }); const mapped = result.map(() => 1); return [result.length, result.map((value) => value === undefined), mapped.length, mapped]`,
    expected: [5, [true, true, true, true, true], 5, [1, 1, 1, 1, 1]],
  },
  {
    path: "test/built-ins/Array/of/creates-a-new-array-from-arguments.js",
    code: `const mixed = Array.of(undefined, false, null, undefined); return [Array.of("Mike", "Rick", "Leo"), mixed.length, mixed[0] === undefined, mixed[1], mixed[2], mixed[3] === undefined, Array.of()]`,
    expected: [["Mike", "Rick", "Leo"], 4, true, false, null, true, []],
  },
] as const

describe("Test262 Array core adaptations", () => {
  for (const item of cases) {
    test(item.path, async () => {
      expect(await value(item.code)).toEqual(item.expected)
    })
  }
})
