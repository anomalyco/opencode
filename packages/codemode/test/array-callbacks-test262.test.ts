/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/built-ins/Array/prototype/map/15.4.4.19-8-1.js
 * - test/built-ins/Array/prototype/map/15.4.4.19-8-2.js
 * - test/built-ins/Array/prototype/map/15.4.4.19-8-b-1.js
 * - test/built-ins/Array/prototype/filter/15.4.4.20-9-1.js
 * - test/built-ins/Array/prototype/filter/15.4.4.20-9-2.js
 * - test/built-ins/Array/prototype/filter/15.4.4.20-9-b-1.js
 * - test/built-ins/Array/prototype/find/predicate-call-parameters.js
 * - test/built-ins/Array/prototype/find/predicate-not-called-on-empty-array.js
 * - test/built-ins/Array/prototype/find/return-found-value-predicate-result-is-true.js
 * - test/built-ins/Array/prototype/find/return-undefined-if-predicate-returns-false-value.js
 * - test/built-ins/Array/prototype/findIndex/predicate-call-parameters.js
 * - test/built-ins/Array/prototype/findIndex/return-index-predicate-result-is-true.js
 * - test/built-ins/Array/prototype/findIndex/return-negative-one-if-predicate-returns-false-value.js
 * - test/built-ins/Array/prototype/findLast/predicate-call-parameters.js
 * - test/built-ins/Array/prototype/findLast/return-found-value-predicate-result-is-true.js
 * - test/built-ins/Array/prototype/findLast/return-undefined-if-predicate-returns-false-value.js
 * - test/built-ins/Array/prototype/findLastIndex/predicate-call-parameters.js
 * - test/built-ins/Array/prototype/findLastIndex/return-index-predicate-result-is-true.js
 * - test/built-ins/Array/prototype/findLastIndex/return-negative-one-if-predicate-returns-false-value.js
 * - test/built-ins/Array/prototype/some/15.4.4.17-7-1.js
 * - test/built-ins/Array/prototype/some/15.4.4.17-8-1.js
 * - test/built-ins/Array/prototype/every/15.4.4.16-7-1.js
 * - test/built-ins/Array/prototype/every/15.4.4.16-8-1.js
 * - test/built-ins/Array/prototype/forEach/15.4.4.18-7-1.js
 * - test/built-ins/Array/prototype/forEach/15.4.4.18-7-2.js
 * - test/built-ins/Array/prototype/reduce/15.4.4.21-9-5.js
 * - test/built-ins/Array/prototype/reduce/15.4.4.21-9-1.js
 * - test/built-ins/Array/prototype/reduce/15.4.4.21-10-1.js
 * - test/built-ins/Array/prototype/reduceRight/15.4.4.22-9-5.js
 * - test/built-ins/Array/prototype/reduceRight/15.4.4.22-9-1.js
 * - test/built-ins/Array/prototype/reduceRight/15.4.4.22-10-1.js
 * - test/built-ins/Array/prototype/flatMap/depth-always-one.js
 * - test/built-ins/Array/prototype/flatMap/mapperfunction-throws.js
 * - test/built-ins/Array/prototype/sort/S15.4.4.11_A1.1_T1.js
 * - test/built-ins/Array/prototype/sort/S15.4.4.11_A2.1_T1.js
 * - test/built-ins/Array/prototype/sort/stability-5-elements.js
 * - test/built-ins/Array/prototype/toSorted/comparefn-controls-sort.js
 * - test/built-ins/Array/prototype/toSorted/comparefn-default.js
 * - test/built-ins/Array/prototype/toSorted/immutable.js
 * - test/built-ins/Array/prototype/toSorted/zero-or-one-element.js
 *
 * Copyright (C) 2015 the V8 project authors. All rights reserved.
 * Copyright (C) 2018 Mathias Bynens. All rights reserved.
 * Copyright (C) 2018 Shilpi Jain and Michael Ficarra. All rights reserved.
 * Copyright (C) 2021 Igalia, S.L. All rights reserved.
 * Copyright (C) 2021 Microsoft. All rights reserved.
 * Copyright (C) 2025 Google. All rights reserved.
 * Copyright (C) 2026 Garham Lee. All rights reserved.
 * Copyright (c) 2012 Ecma International.  All rights reserved.
 * Copyright 2009 the Sputnik authors.  All rights reserved.
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
    path: "test/built-ins/Array/prototype/map/15.4.4.19-8-1.js",
    code: `const input = [1, 2]; input[3] = 4; input[4] = 5; const result = input.map((value) => { input[2] = 3; input[5] = 6; return 1 }); return [result.length, result[5] === undefined]`,
    expected: [5, true],
  },
  {
    path: "test/built-ins/Array/prototype/map/15.4.4.19-8-2.js",
    code: `const input = [1, 2, 3, 4, 5]; const result = input.map((value) => { input[4] = -1; return value > 0 ? 1 : 0 }); return [result.length, result[4]]`,
    expected: [5, 0],
  },
  {
    path: "test/built-ins/Array/prototype/map/15.4.4.19-8-b-1.js",
    code: `const input = []; input[10] = 0; input.pop(); input[1] = undefined; let calls = 0; const result = input.map(() => { calls += 1; return 1 }); return [result.length, calls, 0 in result, 1 in result]`,
    expected: [10, 1, false, true],
  },
  {
    path: "test/built-ins/Array/prototype/filter/15.4.4.20-9-1.js",
    code: `const input = [1, 2]; input[3] = 4; input[4] = 5; const result = input.filter(() => { input[2] = 3; input[5] = 6; return true }); return result`,
    expected: [1, 2, 3, 4, 5],
  },
  {
    path: "test/built-ins/Array/prototype/filter/15.4.4.20-9-2.js",
    code: `const input = [1, 2, 3, 4, 5]; return input.filter((value) => { input[2] = -1; input[4] = -1; return value > 0 })`,
    expected: [1, 2, 4],
  },
  {
    path: "test/built-ins/Array/prototype/filter/15.4.4.20-9-b-1.js",
    code: `const input = []; input[9] = 0; input.pop(); input[1] = undefined; let calls = 0; const result = input.filter(() => { calls += 1; return false }); return [result, calls]`,
    expected: [[], 1],
  },
  {
    path: "test/built-ins/Array/prototype/find/predicate-call-parameters.js",
    code: `const input = [10, 20]; const seen = []; input.find((value, index, receiver) => { seen.push([value, index, receiver === input]); return false }); return seen`,
    expected: [
      [10, 0, true],
      [20, 1, true],
    ],
  },
  {
    path: "test/built-ins/Array/prototype/find/return-found-value-predicate-result-is-true.js",
    code: `return [1, 2, 3].find((value) => value > 1)`,
    expected: 2,
  },
  {
    path: "test/built-ins/Array/prototype/find/return-undefined-if-predicate-returns-false-value.js",
    code: `return [1, 2, 3].find((value) => value > 4) === undefined`,
    expected: true,
  },
  {
    path: "test/built-ins/Array/prototype/find/predicate-not-called-on-empty-array.js",
    code: `let calls = 0; const result = [].find(() => { calls += 1; return true }); return [result === undefined, calls]`,
    expected: [true, 0],
  },
  {
    path: "test/built-ins/Array/prototype/findIndex/predicate-call-parameters.js",
    code: `const input = [10, 20]; const seen = []; input.findIndex((value, index, receiver) => { seen.push([value, index, receiver === input]); return false }); return seen`,
    expected: [
      [10, 0, true],
      [20, 1, true],
    ],
  },
  {
    path: "test/built-ins/Array/prototype/findIndex/return-index-predicate-result-is-true.js",
    code: `return [1, 2, 3].findIndex((value) => value > 1)`,
    expected: 1,
  },
  {
    path: "test/built-ins/Array/prototype/findIndex/return-negative-one-if-predicate-returns-false-value.js",
    code: `return [1, 2, 3].findIndex((value) => value > 4)`,
    expected: -1,
  },
  {
    path: "test/built-ins/Array/prototype/findLast/predicate-call-parameters.js",
    code: `const input = [10, 20]; const seen = []; input.findLast((value, index, receiver) => { seen.push([value, index, receiver === input]); return false }); return seen`,
    expected: [
      [20, 1, true],
      [10, 0, true],
    ],
  },
  {
    path: "test/built-ins/Array/prototype/findLast/return-found-value-predicate-result-is-true.js",
    code: `return [1, 2, 3].findLast((value) => value < 3)`,
    expected: 2,
  },
  {
    path: "test/built-ins/Array/prototype/findLast/return-undefined-if-predicate-returns-false-value.js",
    code: `return [1, 2, 3].findLast((value) => value > 4) === undefined`,
    expected: true,
  },
  {
    path: "test/built-ins/Array/prototype/findLastIndex/predicate-call-parameters.js",
    code: `const input = [10, 20]; const seen = []; input.findLastIndex((value, index, receiver) => { seen.push([value, index, receiver === input]); return false }); return seen`,
    expected: [
      [20, 1, true],
      [10, 0, true],
    ],
  },
  {
    path: "test/built-ins/Array/prototype/findLastIndex/return-index-predicate-result-is-true.js",
    code: `return [1, 2, 3].findLastIndex((value) => value < 3)`,
    expected: 1,
  },
  {
    path: "test/built-ins/Array/prototype/findLastIndex/return-negative-one-if-predicate-returns-false-value.js",
    code: `return [1, 2, 3].findLastIndex((value) => value > 4)`,
    expected: -1,
  },
  {
    path: "test/built-ins/Array/prototype/some/15.4.4.17-7-1.js",
    code: `const input = [1, 2]; input[3] = 4; input[4] = 5; const seen = []; const result = input.some((value) => { input[2] = 3; seen.push(value); return false }); return [result, seen.includes(3)]`,
    expected: [false, true],
  },
  {
    path: "test/built-ins/Array/prototype/some/15.4.4.17-8-1.js",
    code: `return [].some(() => true)`,
    expected: false,
  },
  {
    path: "test/built-ins/Array/prototype/every/15.4.4.16-7-1.js",
    code: `const input = [1, 2]; input[3] = 4; input[4] = 5; const seen = []; const result = input.every((value) => { input[2] = 3; seen.push(value); return true }); return [result, seen.includes(3)]`,
    expected: [true, true],
  },
  {
    path: "test/built-ins/Array/prototype/every/15.4.4.16-8-1.js",
    code: `return [].every(() => false)`,
    expected: true,
  },
  {
    path: "test/built-ins/Array/prototype/forEach/15.4.4.18-7-1.js",
    code: `const input = [1, 2]; input[3] = 4; input[4] = 5; let calls = 0; input.forEach(() => { calls += 1; input[2] = 3; input[5] = 6 }); return calls`,
    expected: 5,
  },
  {
    path: "test/built-ins/Array/prototype/forEach/15.4.4.18-7-2.js",
    code: `const input = [1, 2, 3]; const seen = []; input.forEach((value, index) => { seen.push(value); if (index === 0) input.pop() }); return seen`,
    expected: [1, 2],
  },
  {
    path: "test/built-ins/Array/prototype/reduce/15.4.4.21-9-1.js",
    code: `const input = [1, 2]; input[3] = 4; input[4] = "5"; return input.reduce((accumulator, value) => { input[2] = 3; input[5] = 6; return accumulator + value })`,
    expected: "105",
  },
  {
    path: "test/built-ins/Array/prototype/reduce/15.4.4.21-9-5.js",
    code: `let calls = 0; const result = [1].reduce(() => { calls += 1; return 2 }); return [result, calls]`,
    expected: [1, 0],
  },
  {
    path: "test/built-ins/Array/prototype/reduce/15.4.4.21-10-1.js",
    code: `const input = [1, 2, 3, 4, 5]; input.reduce(() => 1); return input`,
    expected: [1, 2, 3, 4, 5],
  },
  {
    path: "test/built-ins/Array/prototype/reduceRight/15.4.4.22-9-1.js",
    code: `const input = ["1", 2]; input[3] = 4; input[4] = "5"; return input.reduceRight((accumulator, value) => { input[2] = 3; input[5] = 6; return accumulator + value })`,
    expected: "54321",
  },
  {
    path: "test/built-ins/Array/prototype/reduceRight/15.4.4.22-9-5.js",
    code: `let calls = 0; const result = [1].reduceRight(() => { calls += 1; return 2 }); return [result, calls]`,
    expected: [1, 0],
  },
  {
    path: "test/built-ins/Array/prototype/reduceRight/15.4.4.22-10-1.js",
    code: `const input = [1, 2, 3, 4, 5]; input.reduceRight(() => 1); return input`,
    expected: [1, 2, 3, 4, 5],
  },
  {
    path: "test/built-ins/Array/prototype/flatMap/depth-always-one.js",
    code: `return [1, 2, 3].flatMap((value) => [[value * 2]])`,
    expected: [[2], [4], [6]],
  },
  {
    path: "test/built-ins/Array/prototype/flatMap/mapperfunction-throws.js",
    code: `try { [1, 2].flatMap(() => { throw "stop" }) } catch (error) { return error === "stop" } return false`,
    expected: true,
  },
  {
    path: "test/built-ins/Array/prototype/sort/S15.4.4.11_A1.1_T1.js",
    code: `const input = []; input[2] = 0; input.pop(); input.sort(); return [input.length, input[0] === undefined, input[1] === undefined]`,
    expected: [2, true, true],
  },
  {
    path: "test/built-ins/Array/prototype/sort/S15.4.4.11_A2.1_T1.js",
    code: `return ["z", "y", "x", "w", "v", "u", "t", "s", "r", "q", "p", "o", "n", "M", "L", "K", "J", "I", "H", "G", "F", "E", "D", "C", "B", "A"].sort()`,
    expected: [
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
      "M",
      "n",
      "o",
      "p",
      "q",
      "r",
      "s",
      "t",
      "u",
      "v",
      "w",
      "x",
      "y",
      "z",
    ],
  },
  {
    path: "test/built-ins/Array/prototype/sort/stability-5-elements.js",
    code: `const input = [{ n: "A", r: 2 }, { n: "B", r: 3 }, { n: "C", r: 2 }, { n: "D", r: 3 }, { n: "E", r: 3 }]; return input.sort((left, right) => right.r - left.r).map((item) => item.n).join("")`,
    expected: "BDEAC",
  },
  {
    path: "test/built-ins/Array/prototype/toSorted/comparefn-controls-sort.js",
    code: `const mixed = [333, 33, 3, 222, 22, 2, 111, 11, 1]; return [[1, 2, 3, 4].toSorted((a, b) => a - b), [4, 3, 2, 1].toSorted((a, b) => a - b), mixed.toSorted((a, b) => a - b), [1, 2, 3, 4].toSorted((a, b) => b - a), [4, 3, 2, 1].toSorted((a, b) => b - a), mixed.toSorted((a, b) => b - a)]`,
    expected: [
      [1, 2, 3, 4],
      [1, 2, 3, 4],
      [1, 2, 3, 11, 22, 33, 111, 222, 333],
      [4, 3, 2, 1],
      [4, 3, 2, 1],
      [333, 222, 111, 33, 22, 11, 3, 2, 1],
    ],
  },
  {
    path: "test/built-ins/Array/prototype/toSorted/comparefn-default.js",
    code: `return [[1, 2, 3, 4].toSorted(), [4, 3, 2, 1].toSorted(), ["a", 2, 1, "z"].toSorted(), [333, 33, 3, 222, 22, 2, 111, 11, 1].toSorted()]`,
    expected: [
      [1, 2, 3, 4],
      [1, 2, 3, 4],
      [1, 2, "a", "z"],
      [1, 11, 111, 2, 22, 222, 3, 33, 333],
    ],
  },
  {
    path: "test/built-ins/Array/prototype/toSorted/immutable.js",
    code: `const input = [2, 0, 1]; const result = input.toSorted(); return [input, result !== input]`,
    expected: [[2, 0, 1], true],
  },
  {
    path: "test/built-ins/Array/prototype/toSorted/zero-or-one-element.js",
    code: `const zero = []; const one = [1]; const zeroResult = zero.toSorted(); const oneResult = one.toSorted(); return [zeroResult, oneResult, zeroResult !== zero, oneResult !== one]`,
    expected: [[], [1], true, true],
  },
] as const

describe("Test262 Array callback adaptations", () => {
  for (const item of cases) {
    test(item.path, async () => {
      expect(await value(item.code)).toEqual(item.expected)
    })
  }
})
