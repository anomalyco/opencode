/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/built-ins/String/prototype/split/call-split-l-0-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/call-split-l-1-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/call-split-l-2-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/call-split-l-3-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/call-split-l-4-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/call-split-l-na-n-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/call-split-l-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/call-split-ll-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/call-split-h-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/call-split-hello-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/call-split-hellothere-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/call-split-o-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/call-split-x-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/call-split-x-instance-is-empty-string.js
 * - test/built-ins/String/prototype/split/call-split-4-instance-is-string-one-1-two-2-four-4.js
 * - test/built-ins/String/prototype/split/call-split-on-instance-is-string-one-1-two-2-four-4.js
 * - test/built-ins/String/prototype/split/call-split-instance-is-string-one-two-three-four-five.js
 * - test/built-ins/String/prototype/split/call-split-instance-is-string-one-two-three.js
 * - test/built-ins/String/prototype/split/call-split-instance-is-string.js
 * - test/built-ins/String/prototype/split/instance-is-string-one-two-three-four-five.js
 * - test/built-ins/String/prototype/split/instance-is-string.js
 * - test/built-ins/String/prototype/split/separator-colon-instance-is-string-one-1-two-2-four-4.js
 * - test/built-ins/String/prototype/split/separator-comma-instance-is-string-one-two-three-four-five.js
 * - test/built-ins/String/prototype/split/separator-empty-string-instance-is-string.js
 * - test/built-ins/String/prototype/split/call-split-without-arguments-and-instance-is-empty-string.js
 * - test/built-ins/String/prototype/split/separator-undef.js
 * - test/built-ins/String/prototype/slice/S15.5.4.13_A1_T6.js
 * - test/built-ins/String/prototype/slice/S15.5.4.13_A1_T14.js
 * - test/built-ins/String/prototype/slice/S15.5.4.13_A2_T1.js
 * - test/built-ins/String/prototype/slice/S15.5.4.13_A2_T2.js
 * - test/built-ins/String/prototype/slice/S15.5.4.13_A2_T3.js
 * - test/built-ins/String/prototype/slice/S15.5.4.13_A2_T4.js
 * - test/built-ins/String/prototype/slice/S15.5.4.13_A2_T5.js
 * - test/built-ins/String/prototype/slice/S15.5.4.13_A2_T6.js
 * - test/built-ins/String/prototype/slice/S15.5.4.13_A2_T7.js
 * - test/built-ins/String/prototype/slice/S15.5.4.13_A2_T8.js
 * - test/built-ins/String/prototype/slice/S15.5.4.13_A2_T9.js
 * - test/built-ins/String/prototype/substring/S15.5.4.15_A1_T6.js
 * - test/built-ins/String/prototype/substring/S15.5.4.15_A1_T14.js
 * - test/built-ins/String/prototype/substring/S15.5.4.15_A2_T1.js
 * - test/built-ins/String/prototype/substring/S15.5.4.15_A2_T2.js
 * - test/built-ins/String/prototype/substring/S15.5.4.15_A2_T3.js
 * - test/built-ins/String/prototype/substring/S15.5.4.15_A2_T4.js
 * - test/built-ins/String/prototype/substring/S15.5.4.15_A2_T5.js
 * - test/built-ins/String/prototype/substring/S15.5.4.15_A2_T6.js
 * - test/built-ins/String/prototype/substring/S15.5.4.15_A2_T7.js
 * - test/built-ins/String/prototype/substring/S15.5.4.15_A2_T8.js
 * - test/built-ins/String/prototype/substring/S15.5.4.15_A2_T9.js
 * - test/built-ins/String/prototype/substring/S15.5.4.15_A2_T10.js
 * - test/annexB/built-ins/String/prototype/substr/start-negative.js
 * - test/annexB/built-ins/String/prototype/substr/length-negative.js
 * - test/annexB/built-ins/String/prototype/substr/length-positive.js
 * - test/annexB/built-ins/String/prototype/substr/length-falsey.js
 * - test/annexB/built-ins/String/prototype/substr/length-undef.js
 * - test/annexB/built-ins/String/prototype/substr/surrogate-pairs.js
 * - test/built-ins/String/prototype/includes/String.prototype.includes_FailMissingLetter.js
 * - test/built-ins/String/prototype/includes/String.prototype.includes_SuccessNoLocation.js
 * - test/built-ins/String/prototype/includes/String.prototype.includes_FailBadLocation.js
 * - test/built-ins/String/prototype/includes/String.prototype.includes_FailLocation.js
 * - test/built-ins/String/prototype/includes/String.prototype.includes_Success.js
 * - test/built-ins/String/prototype/includes/searchstring-found-with-position.js
 * - test/built-ins/String/prototype/includes/searchstring-found-without-position.js
 * - test/built-ins/String/prototype/includes/searchstring-not-found-with-position.js
 * - test/built-ins/String/prototype/includes/searchstring-not-found-without-position.js
 * - test/built-ins/String/prototype/includes/return-false-with-out-of-bounds-position.js
 * - test/built-ins/String/prototype/includes/return-true-if-searchstring-is-empty.js
 * - test/built-ins/String/prototype/includes/coerced-values-of-position.js
 * - test/built-ins/String/prototype/startsWith/searchstring-found-with-position.js
 * - test/built-ins/String/prototype/startsWith/searchstring-found-without-position.js
 * - test/built-ins/String/prototype/startsWith/searchstring-not-found-with-position.js
 * - test/built-ins/String/prototype/startsWith/searchstring-not-found-without-position.js
 * - test/built-ins/String/prototype/startsWith/out-of-bounds-position.js
 * - test/built-ins/String/prototype/startsWith/return-true-if-searchstring-is-empty.js
 * - test/built-ins/String/prototype/startsWith/coerced-values-of-position.js
 * - test/built-ins/String/prototype/endsWith/String.prototype.endsWith_Success.js
 * - test/built-ins/String/prototype/endsWith/String.prototype.endsWith_Success_2.js
 * - test/built-ins/String/prototype/endsWith/String.prototype.endsWith_Success_3.js
 * - test/built-ins/String/prototype/endsWith/String.prototype.endsWith_Success_4.js
 * - test/built-ins/String/prototype/endsWith/String.prototype.endsWith_Fail.js
 * - test/built-ins/String/prototype/endsWith/String.prototype.endsWith_Fail_2.js
 * - test/built-ins/String/prototype/endsWith/searchstring-found-with-position.js
 * - test/built-ins/String/prototype/endsWith/searchstring-found-without-position.js
 * - test/built-ins/String/prototype/endsWith/searchstring-not-found-with-position.js
 * - test/built-ins/String/prototype/endsWith/searchstring-not-found-without-position.js
 * - test/built-ins/String/prototype/endsWith/return-false-if-search-start-is-less-than-zero.js
 * - test/built-ins/String/prototype/endsWith/return-true-if-searchstring-is-empty.js
 * - test/built-ins/String/prototype/endsWith/coerced-values-of-position.js
 * - test/built-ins/String/prototype/indexOf/S15.5.4.7_A2_T1.js
 * - test/built-ins/String/prototype/indexOf/S15.5.4.7_A2_T2.js
 * - test/built-ins/String/prototype/indexOf/S15.5.4.7_A2_T3.js
 * - test/built-ins/String/prototype/indexOf/S15.5.4.7_A2_T4.js
 * - test/built-ins/String/prototype/indexOf/S15.5.4.7_A3_T1.js
 * - test/built-ins/String/prototype/indexOf/S15.5.4.7_A3_T3.js
 * - test/built-ins/String/prototype/indexOf/position-tointeger.js
 * - test/built-ins/String/prototype/indexOf/searchstring-tostring.js
 * - test/built-ins/String/prototype/lastIndexOf/not-a-substring.js
 *
 * Copyright 2009 the Sputnik authors.  All rights reserved.
 * Copyright (c) 2014 Ryan Lewis. All rights reserved.
 * Copyright (C) 2015 the V8 project authors. All rights reserved.
 * Copyright (C) 2016 the V8 project authors. All rights reserved.
 * Copyright (C) 2017 Josh Wolfe. All rights reserved.
 * Copyright (C) 2020 Leo Balter. All rights reserved.
 * Copyright (C) 2026 Garham Lee. All rights reserved.
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
    path: "test/built-ins/String/prototype/split/call-split-l-0-instance-is-string-hello.js",
    code: `const result = "hello".split("l", 0); return [result.length, result[0] === undefined]`,
    expected: [0, true],
    labels: [
      "The value of __split.length is expected to equal the value of __expected.length",
      "The value of __split[0] is expected to equal the value of __expected[0]",
    ],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-l-1-instance-is-string-hello.js",
    code: `const result = "hello".split("l", 1); return [result.length, result[0]]`,
    expected: [1, "he"],
    labels: [
      "The value of __split.length is expected to equal the value of __expected.length",
      "The value of __split[0] is expected to equal the value of __expected[0]",
    ],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-l-2-instance-is-string-hello.js",
    code: `const result = "hello".split("l", 2); return [result.length, result[0], result[1]]`,
    expected: [2, "he", ""],
    labels: [
      "The value of __split.length is expected to equal the value of __expected.length",
      "The value of __split[index] is expected to equal the value of __expected[index]",
      "The value of __split[index] is expected to equal the value of __expected[index]",
    ],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-l-3-instance-is-string-hello.js",
    code: `const result = "hello".split("l", 3); return [result.length, result[0], result[1], result[2]]`,
    expected: [3, "he", "", "o"],
    labels: [
      "The value of __split.length is expected to equal the value of __expected.length",
      "The value of __split[index] is expected to equal the value of __expected[index]",
      "The value of __split[index] is expected to equal the value of __expected[index]",
      "The value of __split[index] is expected to equal the value of __expected[index]",
    ],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-l-4-instance-is-string-hello.js",
    code: `const result = "hello".split("l", 4); return [result.length, result[0], result[1], result[2]]`,
    expected: [3, "he", "", "o"],
    labels: [
      "The value of __split.length is expected to equal the value of __expected.length",
      "The value of __split[index] is expected to equal the value of __expected[index]",
      "The value of __split[index] is expected to equal the value of __expected[index]",
      "The value of __split[index] is expected to equal the value of __expected[index]",
    ],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-l-na-n-instance-is-string-hello.js",
    code: `const result = "hello".split("l", NaN); return [result.length, result[0] === undefined]`,
    expected: [0, true],
    labels: [
      "The value of __split.length is expected to equal the value of __expected.length",
      "The value of __split[0] is expected to equal the value of __expected[0]",
    ],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-l-instance-is-string-hello.js",
    code: `const result = "hello".split("l"); return [result.length, result[0], result[1], result[2]]`,
    expected: [3, "he", "", "o"],
    labels: [
      "The value of __split.length is 3",
      'The value of __split[0] is "he"',
      'The value of __split[1] is ""',
      'The value of __split[2] is "o"',
    ],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-ll-instance-is-string-hello.js",
    code: `const result = "hello".split("ll"); return [result.length, result[0], result[1]]`,
    expected: [2, "he", "o"],
    labels: ["The value of __split.length is 2", 'The value of __split[0] is "he"', 'The value of __split[1] is "o"'],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-h-instance-is-string-hello.js",
    code: `const result = "hello".split("h"); return [result.length, result[0], result[1]]`,
    expected: [2, "", "ello"],
    labels: ["The value of __split.length is 2", 'The value of __split[0] is ""', 'The value of __split[1] is "ello"'],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-hello-instance-is-string-hello.js",
    code: `const result = "hello".split("hello"); return [result.length, result[0], result[1]]`,
    expected: [2, "", ""],
    labels: ["The value of __split.length is 2", 'The value of __split[0] is ""', 'The value of __split[1] is ""'],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-hellothere-instance-is-string-hello.js",
    code: `const result = "hello".split("hellothere"); return [result.length, result[0]]`,
    expected: [1, "hello"],
    labels: ["The value of __split.length is 1", 'The value of __split[0] is "hello"'],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-o-instance-is-string-hello.js",
    code: `const result = "hello".split("o"); return [result.length, result[0], result[1]]`,
    expected: [2, "hell", ""],
    labels: ["The value of __split.length is 2", 'The value of __split[0] is "hell"', 'The value of __split[1] is ""'],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-x-instance-is-string-hello.js",
    code: `const result = "hello".split("x"); return [result.length, result[0]]`,
    expected: [1, "hello"],
    labels: ["The value of __split.length is 1", 'The value of __split[0] is "hello"'],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-x-instance-is-empty-string.js",
    code: `const result = "".split("x"); return [result.length, result[0]]`,
    expected: [1, ""],
    labels: ["The value of __split.length is 1", 'The value of __split[0] is ""'],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-4-instance-is-string-one-1-two-2-four-4.js",
    code: `const result = "one-1 two-2 four-4".split("-4"); return [result.length, result[0], result[1]]`,
    expected: [2, "one-1 two-2 four", ""],
    labels: [
      "The value of __split.length is 2",
      'The value of __split[0] is "one-1 two-2 four"',
      'The value of __split[1] is ""',
    ],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-on-instance-is-string-one-1-two-2-four-4.js",
    code: `const result = "one-1 two-2 four-4".split("on"); return [result.length, result[0], result[1]]`,
    expected: [2, "", "e-1 two-2 four-4"],
    labels: [
      "The value of __split.length is 2",
      'The value of __split[0] is ""',
      'The value of __split[1] is "e-1 two-2 four-4"',
    ],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-instance-is-string-one-two-three-four-five.js",
    code: `const result = "one two three four five".split(" "); return [result.length, ...result]`,
    expected: [5, "one", "two", "three", "four", "five"],
    labels: [
      "The value of __split.length is 5", 'The value of __split[0] is "one"', 'The value of __split[1] is "two"',
      'The value of __split[2] is "three"', 'The value of __split[3] is "four"', 'The value of __split[4] is "five"',
    ],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-instance-is-string-one-two-three.js",
    code: `const result = "one two three".split(""); return [result[0], result[1], result[11], result[12]]`,
    expected: ["o", "n", "e", "e"],
    labels: [
      'The value of __split[0] is "o"', 'The value of __split[1] is "n"',
      'The value of __split[11] is "e"', 'The value of __split[12] is "e"',
    ],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-instance-is-string.js",
    code: `const result = " ".split(" "); return [result.length, result[0], result[1]]`,
    expected: [2, "", ""],
    labels: ["The value of __split.length is 2", 'The value of __split[0] is ""', 'The value of __split[1] is ""'],
  },
  {
    path: "test/built-ins/String/prototype/split/instance-is-string-one-two-three-four-five.js",
    code: `const result = "one,two,three,four,five".split(); return [result.length, result[0]]`,
    expected: [1, "one,two,three,four,five"],
    labels: ["The value of __split.length is 1", 'The value of __split[0] is "one,two,three,four,five"'],
  },
  {
    path: "test/built-ins/String/prototype/split/instance-is-string.js",
    code: `const result = " ".split(); return [result.length, result[0]]`,
    expected: [1, " "],
    labels: ["The value of __split.length is 1", 'The value of __split[0] is " "'],
  },
  {
    path: "test/built-ins/String/prototype/split/separator-colon-instance-is-string-one-1-two-2-four-4.js",
    code: `const result = "one-1,two-2,four-4".split(":"); return [result.length, result[0]]`,
    expected: [1, "one-1,two-2,four-4"],
    labels: ["The value of __split.length is 1", 'The value of __split[0] is "one-1,two-2,four-4"'],
  },
  {
    path: "test/built-ins/String/prototype/split/separator-comma-instance-is-string-one-two-three-four-five.js",
    code: `const result = "one,two,three,four,five".split(","); return [result.length, ...result]`,
    expected: [5, "one", "two", "three", "four", "five"],
    labels: [
      "The value of __split.length is 5",
      'The value of __split[0] is "one"',
      'The value of __split[1] is "two"',
      'The value of __split[2] is "three"',
      'The value of __split[3] is "four"',
      'The value of __split[4] is "five"',
    ],
  },
  {
    path: "test/built-ins/String/prototype/split/separator-empty-string-instance-is-string.js",
    code: `const result = " ".split(""); return [result.length, result[0]]`,
    expected: [1, " "],
    labels: ["The value of __split.length is 1", 'The value of __split[0] is " "'],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-without-arguments-and-instance-is-empty-string.js",
    code: `const result = "".split(); return [result.length, result[0]]`,
    expected: [1, ""],
    labels: ["The value of __split.length is 1", 'The value of __split[0] is ""'],
  },
  {
    path: "test/built-ins/String/prototype/split/separator-undef.js",
    code: `const result = "undefined is not a function".split(); return [Array.isArray(result), result.length, result[0]]`,
    expected: [true, 1, "undefined is not a function"],
    labels: ["implicit separator, result is array", "implicit separator, result.length", "implicit separator, [0] is the same string"],
  },
  {
    path: "test/built-ins/String/prototype/slice/S15.5.4.13_A1_T6.js",
    code: `return ["undefined".slice(undefined, 3)]`,
    expected: ["und"],
    labels: ['#1: new String("undefined").slice(x,3) === "und"'],
  },
  {
    path: "test/built-ins/String/prototype/slice/S15.5.4.13_A1_T14.js",
    code: `return ["report".slice(undefined)]`,
    expected: ["report"],
    labels: ['#1: "report".slice(function(){}()) === "report"'],
  },
  {
    path: "test/built-ins/String/prototype/slice/S15.5.4.13_A2_T1.js",
    code: `return [typeof "this is a string object".slice()]`,
    expected: ["string"],
    labels: ['#1: typeof __string.slice() === "string"'],
  },
  {
    path: "test/built-ins/String/prototype/slice/S15.5.4.13_A2_T2.js",
    code: `return ["this is a string object".slice(NaN, Infinity)]`,
    expected: ["this is a string object"],
    labels: ['#1: __string.slice(NaN, Infinity) === "this is a string object"'],
  },
  {
    path: "test/built-ins/String/prototype/slice/S15.5.4.13_A2_T3.js",
    code: `return ["".slice(1, 0)]`,
    expected: [""],
    labels: ['#1: __string.slice(1,0) === ""'],
  },
  {
    path: "test/built-ins/String/prototype/slice/S15.5.4.13_A2_T4.js",
    code: `return ["this is a string object".slice(Infinity, NaN)]`,
    expected: [""],
    labels: ['#1: __string.slice(Infinity, NaN) === ""'],
  },
  {
    path: "test/built-ins/String/prototype/slice/S15.5.4.13_A2_T5.js",
    code: `return ["this is a string object".slice(Infinity, Infinity)]`,
    expected: [""],
    labels: ['#1: __string.slice(Infinity, Infinity) === ""'],
  },
  {
    path: "test/built-ins/String/prototype/slice/S15.5.4.13_A2_T6.js",
    code: `return ["this is a string object".slice(-0.01, 0)]`,
    expected: [""],
    labels: ['#1: __string.slice(-0.01,0) === ""'],
  },
  {
    path: "test/built-ins/String/prototype/slice/S15.5.4.13_A2_T7.js",
    code: `const text = "this is a string object"; return [text.slice(text.length, text.length)]`,
    expected: [""],
    labels: ['#1: __string.slice(__string.length, __string.length) === ""'],
  },
  {
    path: "test/built-ins/String/prototype/slice/S15.5.4.13_A2_T8.js",
    code: `const text = "this is a string object"; return [text.slice(text.length + 1, 0)]`,
    expected: [""],
    labels: ['#1: __string.slice(__string.length+1, 0) === ""'],
  },
  {
    path: "test/built-ins/String/prototype/slice/S15.5.4.13_A2_T9.js",
    code: `return ["this is a string object".slice(-Infinity, -Infinity)]`,
    expected: [""],
    labels: ['#1: __string.slice(-Infinity, -Infinity) === ""'],
  },
  {
    path: "test/built-ins/String/prototype/substring/S15.5.4.15_A1_T6.js",
    code: `return ["undefined".substring(undefined, 3)]`,
    expected: ["und"],
    labels: ['#1: new String("undefined").substring(x,3) === "und"'],
  },
  {
    path: "test/built-ins/String/prototype/substring/S15.5.4.15_A1_T14.js",
    code: `return ["report".substring(undefined)]`,
    expected: ["report"],
    labels: ['#1: "report".substring(function(){}()) === "report"'],
  },
  {
    path: "test/built-ins/String/prototype/substring/S15.5.4.15_A2_T1.js",
    code: `return [typeof "this is a string object".substring()]`,
    expected: ["string"],
    labels: ['#1: typeof __string.substring() === "string"'],
  },
  {
    path: "test/built-ins/String/prototype/substring/S15.5.4.15_A2_T2.js",
    code: `return ["this is a string object".substring(NaN, Infinity)]`,
    expected: ["this is a string object"],
    labels: ['#1: __string.substring(NaN, Infinity) === "this is a string object"'],
  },
  {
    path: "test/built-ins/String/prototype/substring/S15.5.4.15_A2_T3.js",
    code: `return ["".substring(1, 0)]`,
    expected: [""],
    labels: ['#1: __string.substring(1,0) === ""'],
  },
  {
    path: "test/built-ins/String/prototype/substring/S15.5.4.15_A2_T4.js",
    code: `return ["this is a string object".substring(Infinity, NaN)]`,
    expected: ["this is a string object"],
    labels: ['#1: __string.substring(Infinity, NaN) === "this is a string object"'],
  },
  {
    path: "test/built-ins/String/prototype/substring/S15.5.4.15_A2_T5.js",
    code: `return ["this is a string object".substring(Infinity, Infinity)]`,
    expected: [""],
    labels: ['#1: __string.substring(Infinity, Infinity) === ""'],
  },
  {
    path: "test/built-ins/String/prototype/substring/S15.5.4.15_A2_T6.js",
    code: `return ["this is a string object".substring(-0.01, 0)]`,
    expected: [""],
    labels: ['#1: __string.substring(-0.01,0) === ""'],
  },
  {
    path: "test/built-ins/String/prototype/substring/S15.5.4.15_A2_T7.js",
    code: `const text = "this is a string object"; return [text.substring(text.length, text.length)]`,
    expected: [""],
    labels: ['#1: __string.substring(__string.length, __string.length) === ""'],
  },
  {
    path: "test/built-ins/String/prototype/substring/S15.5.4.15_A2_T8.js",
    code: `const text = "this is a string object"; return [text.substring(text.length + 1, 0)]`,
    expected: ["this is a string object"],
    labels: ['#1: __string.substring(__string.length+1, 0) === "this is a string object"'],
  },
  {
    path: "test/built-ins/String/prototype/substring/S15.5.4.15_A2_T9.js",
    code: `return ["this is a string object".substring(-Infinity, -Infinity)]`,
    expected: [""],
    labels: ['#1: __string.substring(-Infinity, -Infinity) === ""'],
  },
  {
    path: "test/built-ins/String/prototype/substring/S15.5.4.15_A2_T10.js",
    code: `return ["this_is_a_string object".substring(0, 8)]`,
    expected: ["this_is_"],
    labels: ['#1: __string.substring(0,8) === "this_is_"'],
  },
  {
    path: "test/annexB/built-ins/String/prototype/substr/start-negative.js",
    code: `return ["abc".substr(-1), "abc".substr(-2), "abc".substr(-3), "abc".substr(-4), "abc".substr(-1.1)]`,
    expected: ["c", "bc", "abc", "abc", "c"],
    labels: ["-1", "-2", "-3", "size + intStart < 0", "floating point rounding semantics"],
  },
  {
    path: "test/annexB/built-ins/String/prototype/substr/length-negative.js",
    code: `return [
      "abc".substr(0, -1), "abc".substr(0, -2), "abc".substr(0, -3), "abc".substr(0, -4),
      "abc".substr(1, -1), "abc".substr(1, -2), "abc".substr(1, -3), "abc".substr(1, -4),
      "abc".substr(2, -1), "abc".substr(2, -2), "abc".substr(2, -3), "abc".substr(2, -4),
      "abc".substr(3, -1), "abc".substr(3, -2), "abc".substr(3, -3), "abc".substr(3, -4),
    ]`,
    expected: ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    labels: [
      "0, -1", "0, -2", "0, -3", "0, -4", "1, -1", "1, -2", "1, -3", "1, -4",
      "2, -1", "2, -2", "2, -3", "2, -4", "3, -1", "3, -2", "3, -3", "3, -4",
    ],
  },
  {
    path: "test/annexB/built-ins/String/prototype/substr/length-positive.js",
    code: `return [
      "abc".substr(0, 1), "abc".substr(0, 2), "abc".substr(0, 3), "abc".substr(0, 4),
      "abc".substr(1, 1), "abc".substr(1, 2), "abc".substr(1, 3), "abc".substr(1, 4),
      "abc".substr(2, 1), "abc".substr(2, 2), "abc".substr(2, 3), "abc".substr(2, 4),
      "abc".substr(3, 1), "abc".substr(3, 2), "abc".substr(3, 3), "abc".substr(3, 4),
    ]`,
    expected: ["a", "ab", "abc", "abc", "b", "bc", "bc", "bc", "c", "c", "c", "c", "", "", "", ""],
    labels: [
      "0, 1", "0, 1", "0, 1", "0, 1", "1, 1", "1, 1", "1, 1", "1, 1",
      "2, 1", "2, 1", "2, 1", "2, 1", "3, 1", "3, 1", "3, 1", "3, 1",
    ],
  },
  {
    path: "test/annexB/built-ins/String/prototype/substr/length-falsey.js",
    code: `return ["abc".substr(0, NaN), "abc".substr(1, NaN), "abc".substr(2, NaN), "abc".substr(3, NaN)]`,
    expected: ["", "", "", ""],
    labels: ["start: 0, length: NaN", "start: 1, length: NaN", "start: 2, length: NaN", "start: 3, length: NaN"],
  },
  {
    path: "test/annexB/built-ins/String/prototype/substr/length-undef.js",
    code: `return [
      "abc".substr(0), "abc".substr(1), "abc".substr(2), "abc".substr(3),
      "abc".substr(0, undefined), "abc".substr(1, undefined), "abc".substr(2, undefined), "abc".substr(3, undefined),
    ]`,
    expected: ["abc", "bc", "c", "", "abc", "bc", "c", ""],
    labels: [
      "start: 0, length: unspecified", "start: 1, length: unspecified", "start: 2, length: unspecified", "start: 3, length: unspecified",
      "start: 0, length: undefined", "start: 1, length: undefined", "start: 2, length: undefined", "start: 3, length: undefined",
    ],
  },
  {
    path: "test/annexB/built-ins/String/prototype/substr/surrogate-pairs.js",
    code: `return [
      "\uD834\uDF06".substr(0), "\uD834\uDF06".substr(1), "\uD834\uDF06".substr(2),
      "\uD834\uDF06".substr(0, 0), "\uD834\uDF06".substr(0, 1), "\uD834\uDF06".substr(0, 2),
    ]`,
    expected: ["\uD834\uDF06", "\uDF06", "", "", "\uD834", "\uD834\uDF06"],
    labels: ["start: 0", "start: 1", "start: 2", "end: 0", "end: 1", "end: 2"],
  },
  {
    path: "test/built-ins/String/prototype/includes/String.prototype.includes_FailMissingLetter.js",
    code: `return ["word".includes("a", 0)]`, expected: [false], labels: ['"word".includes("a", 0)'],
  },
  {
    path: "test/built-ins/String/prototype/includes/String.prototype.includes_SuccessNoLocation.js",
    code: `return ["word".includes("w")]`, expected: [true], labels: ['"word".includes("w")'],
  },
  {
    path: "test/built-ins/String/prototype/includes/String.prototype.includes_FailBadLocation.js",
    code: `return ["word".includes("w", 5)]`, expected: [false], labels: ['"word".includes("w", 5)'],
  },
  {
    path: "test/built-ins/String/prototype/includes/String.prototype.includes_FailLocation.js",
    code: `return ["word".includes("o", 3)]`, expected: [false], labels: ['"word".includes("o", 3)'],
  },
  {
    path: "test/built-ins/String/prototype/includes/String.prototype.includes_Success.js",
    code: `return ["word".includes("w", 0)]`, expected: [true], labels: ['"word".includes("w", 0)'],
  },
  {
    path: "test/built-ins/String/prototype/includes/searchstring-found-with-position.js",
    code: `const text = "The future is cool!"; return [text.includes("The future", 0), text.includes(" is ", 1), text.includes("cool!", 10)]`,
    expected: [true, true, true],
    labels: [
      'Returns true for str.includes("The future", 0)',
      'Returns true for str.includes(" is ", 1)',
      'Returns true for str.includes("cool!", 10)',
    ],
  },
  {
    path: "test/built-ins/String/prototype/includes/searchstring-found-without-position.js",
    code: `const text = "The future is cool!"; return [text.includes("The future"), text.includes("is cool!"), text.includes(text)]`,
    expected: [true, true, true],
    labels: [
      'Returns true for str.includes("The future")',
      'Returns true for str.includes("is cool!")',
      "Returns true for str.includes(str)",
    ],
  },
  {
    path: "test/built-ins/String/prototype/includes/searchstring-not-found-with-position.js",
    code: `const text = "The future is cool!"; return [text.includes("The future", 1), text.includes(text, 1)]`,
    expected: [false, false],
    labels: ['Returns false on str.includes("The future", 1)', "Returns false on str.includes(str, 1)"],
  },
  {
    path: "test/built-ins/String/prototype/includes/searchstring-not-found-without-position.js",
    code: `const text = "The future is cool!"; return [text.includes("Flash"), text.includes("FUTURE")]`,
    expected: [false, false], labels: ["Flash if not included", "includes is case sensitive"],
  },
  {
    path: "test/built-ins/String/prototype/includes/return-false-with-out-of-bounds-position.js",
    code: `const text = "The future is cool!"; return [
      text.includes("!", text.length + 1), text.includes("!", 100), text.includes("!", Infinity), text.includes("!", text.length),
    ]`,
    expected: [false, false, false, false],
    labels: [
      'str.includes("!", str.length + 1) returns false', 'str.includes("!", 100) returns false',
      'str.includes("!", Infinity) returns false', 'str.includes("!", str.length) returns false',
    ],
  },
  {
    path: "test/built-ins/String/prototype/includes/return-true-if-searchstring-is-empty.js",
    code: `const text = "The future is cool!"; return [text.includes("", text.length), text.includes(""), text.includes("", Infinity)]`,
    expected: [true, true, true],
    labels: ['str.includes("", str.length) returns true', 'str.includes("") returns true', 'str.includes("", Infinity) returns true'],
  },
  {
    path: "test/built-ins/String/prototype/includes/coerced-values-of-position.js",
    code: `const text = "The future is cool!"; return [
      text.includes("The future", NaN), text.includes("The future", undefined), text.includes("The future", 0.4),
      text.includes("The future", -1), text.includes("The future", 1.4),
    ]`,
    expected: [true, true, true, true, false],
    labels: ["NaN coerced to 0", "undefined coerced to 0", "0.4 coerced to 0", "negative position", "1.4 coerced to 1"],
  },
  {
    path: "test/built-ins/String/prototype/startsWith/searchstring-found-with-position.js",
    code: `const text = "The future is cool!"; return [text.startsWith("The future", 0), text.startsWith("future", 4), text.startsWith(" is cool!", 10)]`,
    expected: [true, true, true],
    labels: [
      'str.startsWith("The future", 0) === true', 'str.startsWith("future", 4) === true',
      'str.startsWith(" is cool!", 10) === true',
    ],
  },
  {
    path: "test/built-ins/String/prototype/startsWith/searchstring-found-without-position.js",
    code: `const text = "The future is cool!"; return [text.startsWith("The "), text.startsWith("The future"), text.startsWith(text)]`,
    expected: [true, true, true],
    labels: ['str.startsWith("The ") === true', 'str.startsWith("The future") === true', "str.startsWith(str) === true"],
  },
  {
    path: "test/built-ins/String/prototype/startsWith/searchstring-not-found-with-position.js",
    code: `const text = "The future is cool!"; return [text.startsWith("The future", 1), text.startsWith(text, 1)]`,
    expected: [false, false],
    labels: ['str.startsWith("The future", 1) === false', "str.startsWith(str, 1) === false"],
  },
  {
    path: "test/built-ins/String/prototype/startsWith/searchstring-not-found-without-position.js",
    code: `const text = "The future is cool!"; return [text.startsWith("Flash"), text.startsWith("THE FUTURE"), text.startsWith("future is cool!")]`,
    expected: [false, false, false],
    labels: ['str.startsWith("Flash") === false', "startsWith is case sensitive", 'str.startsWith("future is cool!") === false'],
  },
  {
    path: "test/built-ins/String/prototype/startsWith/out-of-bounds-position.js",
    code: `const text = "The future is cool!"; return [
      text.startsWith("!", text.length), text.startsWith("!", 100), text.startsWith("!", Infinity),
      text.startsWith("The future", -1), text.startsWith("The future", -Infinity),
    ]`,
    expected: [false, false, false, true, true],
    labels: [
      'str.startsWith("!", str.length) returns false', 'str.startsWith("!", 100) returns false',
      'str.startsWith("!", Infinity) returns false', "position argument < 0 will search from the start of the string (-1)",
      "position argument < 0 will search from the start of the string (-Infinity)",
    ],
  },
  {
    path: "test/built-ins/String/prototype/startsWith/return-true-if-searchstring-is-empty.js",
    code: `const text = "The future is cool!"; return [text.startsWith(""), text.startsWith("", text.length), text.startsWith("", Infinity)]`,
    expected: [true, true, true],
    labels: ['str.startsWith("") returns true', 'str.startsWith("", str.length) returns true', 'str.startsWith("", Infinity) returns true'],
  },
  {
    path: "test/built-ins/String/prototype/startsWith/coerced-values-of-position.js",
    code: `const text = "The future is cool!"; return [
      text.startsWith("The future", NaN), text.startsWith("The future", undefined),
      text.startsWith("The future", 0.4), text.startsWith("The future", 1.4),
    ]`,
    expected: [true, true, true, false],
    labels: ["NaN coerced to 0", "undefined coerced to 0", "0.4 coerced to 0", "1.4 coerced to 1"],
  },
  {
    path: "test/built-ins/String/prototype/endsWith/String.prototype.endsWith_Success.js",
    code: `return ["word".endsWith("d")]`, expected: [true], labels: ['"word".endsWith("d")'],
  },
  {
    path: "test/built-ins/String/prototype/endsWith/String.prototype.endsWith_Success_2.js",
    code: `return ["word".endsWith("d", 4)]`, expected: [true], labels: ['"word".endsWith("d", 4)'],
  },
  {
    path: "test/built-ins/String/prototype/endsWith/String.prototype.endsWith_Success_3.js",
    code: `return ["word".endsWith("d", 25)]`, expected: [true], labels: ['"word".endsWith("d", 25)'],
  },
  {
    path: "test/built-ins/String/prototype/endsWith/String.prototype.endsWith_Success_4.js",
    code: `return ["word".endsWith("r", 3)]`, expected: [true], labels: ['"word".endsWith("r", 3)'],
  },
  {
    path: "test/built-ins/String/prototype/endsWith/String.prototype.endsWith_Fail.js",
    code: `return ["word".endsWith("r")]`, expected: [false], labels: ['"word".endsWith("r")'],
  },
  {
    path: "test/built-ins/String/prototype/endsWith/String.prototype.endsWith_Fail_2.js",
    code: `return ["word".endsWith("d", 3)]`, expected: [false], labels: ['"word".endsWith("d", 3)'],
  },
  {
    path: "test/built-ins/String/prototype/endsWith/searchstring-found-with-position.js",
    code: `const text = "The future is cool!"; return [text.endsWith("The future", 10), text.endsWith("future", 10), text.endsWith(" is cool!", text.length)]`,
    expected: [true, true, true],
    labels: [
      'str.endsWith("The future", 10) === true', 'str.endsWith("future", 10) === true',
      'str.endsWith(" is cool!", str.length) === true',
    ],
  },
  {
    path: "test/built-ins/String/prototype/endsWith/searchstring-found-without-position.js",
    code: `const text = "The future is cool!"; return [text.endsWith("cool!"), text.endsWith("!"), text.endsWith(text)]`,
    expected: [true, true, true],
    labels: ['str.endsWith("cool!") === true', 'str.endsWith("!") === true', "str.endsWith(str) === true"],
  },
  {
    path: "test/built-ins/String/prototype/endsWith/searchstring-not-found-with-position.js",
    code: `const text = "The future is cool!"; return [text.endsWith("is cool!", text.length - 1), text.endsWith("!", 1)]`,
    expected: [false, false],
    labels: ['str.endsWith("is cool!", str.length - 1) === false', 'str.endsWith("!", 1) === false'],
  },
  {
    path: "test/built-ins/String/prototype/endsWith/searchstring-not-found-without-position.js",
    code: `const text = "The future is cool!"; return [text.endsWith("is Flash!"), text.endsWith("IS COOL!"), text.endsWith("The future")]`,
    expected: [false, false, false],
    labels: ['str.endsWith("is Flash!") === false', "endsWith is case sensitive", 'str.endsWith("The future") === false'],
  },
  {
    path: "test/built-ins/String/prototype/endsWith/return-false-if-search-start-is-less-than-zero.js",
    code: `return ["web".endsWith("w", 0), "Bob".endsWith("  Bob")]`,
    expected: [false, false],
    labels: ['"web".endsWith("w", 0) returns false', '"Bob".endsWith("  Bob") returns false'],
  },
  {
    path: "test/built-ins/String/prototype/endsWith/return-true-if-searchstring-is-empty.js",
    code: `const text = "The future is cool!"; return [
      text.endsWith(""), text.endsWith("", text.length), text.endsWith("", Infinity),
      text.endsWith("", -1), text.endsWith("", -Infinity),
    ]`,
    expected: [true, true, true, true, true],
    labels: [
      'str.endsWith("") returns true', 'str.endsWith("", str.length) returns true', 'str.endsWith("", Infinity) returns true',
      'str.endsWith("", -1) returns true', 'str.endsWith("", -Infinity) returns true',
    ],
  },
  {
    path: "test/built-ins/String/prototype/endsWith/coerced-values-of-position.js",
    code: `const text = "The future is cool!"; return [
      text.endsWith("", NaN), text.endsWith("", undefined), text.endsWith("The future", 10.4),
    ]`,
    expected: [true, true, true],
    labels: ["NaN coerced to 0", "undefined coerced to 0", "10.4 coerced to 10"],
  },
  {
    path: "test/built-ins/String/prototype/indexOf/S15.5.4.7_A2_T1.js",
    code: `return ["abcd".indexOf("abcdab")]`, expected: [-1], labels: ['#1: "abcd".indexOf("abcdab")===-1'],
  },
  {
    path: "test/built-ins/String/prototype/indexOf/S15.5.4.7_A2_T2.js",
    code: `return ["abcd".indexOf("abcdab", 0)]`, expected: [-1], labels: ['#1: "abcd".indexOf("abcdab",0)===-1'],
  },
  {
    path: "test/built-ins/String/prototype/indexOf/S15.5.4.7_A2_T3.js",
    code: `return ["abcd".indexOf("abcdab", 99)]`, expected: [-1], labels: ['#1: "abcd".indexOf("abcdab",99)===-1'],
  },
  {
    path: "test/built-ins/String/prototype/indexOf/S15.5.4.7_A2_T4.js",
    code: `return ["abcd".indexOf("abcdab", NaN)]`, expected: [-1], labels: ['#1: "abcd".indexOf("abcdab",NaN)===-1'],
  },
  {
    path: "test/built-ins/String/prototype/indexOf/S15.5.4.7_A3_T1.js",
    code: `return ["$$abcdabcd".indexOf("ab", NaN)]`, expected: [2], labels: ['#1: "$$abcdabcd".indexOf("ab",NaN)===2'],
  },
  {
    path: "test/built-ins/String/prototype/indexOf/S15.5.4.7_A3_T3.js",
    code: `return ["$$abcdabcd".indexOf("ab", -Infinity)]`, expected: [2], labels: ['#1: "$$abcdabcd".indexOf("ab", function(){return -Infinity;}())===2'],
  },
  {
    path: "test/built-ins/String/prototype/indexOf/position-tointeger.js",
    code: `return [
      "aaaa".indexOf("aa", 0), "aaaa".indexOf("aa", 1), "aaaa".indexOf("aa", -0.9),
      "aaaa".indexOf("aa", 0.9), "aaaa".indexOf("aa", 1.9), "aaaa".indexOf("aa", NaN),
      "aaaa".indexOf("aa", Infinity), "aaaa".indexOf("aa", undefined),
      "aaaa".indexOf("aa", 2), "aaaa".indexOf("aa", 2.9),
    ]`,
    expected: [0, 1, 0, 0, 1, 0, -1, 0, 2, 2],
    labels: [
      "position 0", "position 1", "ToInteger: truncate towards 0 (-0.9)", "ToInteger: truncate towards 0 (0.9)",
      "ToInteger: truncate towards 0 (1.9)", "ToInteger: NaN => 0", "position Infinity",
      "ToInteger: undefined => NaN => 0", "position 2", "ToInteger: truncate towards 0 (2.9)",
    ],
  },
  {
    path: "test/built-ins/String/prototype/indexOf/searchstring-tostring.js",
    code: `return ["foo".indexOf(""), "__foo__".indexOf("foo")]`,
    expected: [0, 2], labels: ['"foo".indexOf("")', '"__foo__".indexOf("foo")'],
  },
  {
    path: "test/built-ins/String/prototype/lastIndexOf/not-a-substring.js",
    code: `return ["abc".lastIndexOf("d")]`,
    expected: [-1],
    labels: ["String.prototype.lastIndexOf returns -1 when searchString is shorter than this and searchString is not a substring of this."],
  },
] as const

describe("Test262-adapted String search and extraction behavior", () => {
  for (const item of cases) {
    test(item.path, async () => {
      const actual = await value(item.code)
      if (!Array.isArray(actual)) throw new Error(`expected assertion values for ${item.path}`)
      expect(actual.length, "adapted assertion count").toBe(item.expected.length)
      item.expected.forEach((expected, index) => expect(actual[index], item.labels[index]!).toEqual(expected))
    })
  }
})
