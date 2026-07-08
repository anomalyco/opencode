/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/built-ins/String/prototype/includes/searchstring-found-with-position.js
 * - test/built-ins/String/prototype/startsWith/searchstring-found-with-position.js
 * - test/built-ins/String/prototype/endsWith/searchstring-found-with-position.js
 * - test/built-ins/String/prototype/indexOf/S15.5.4.7_A3_T1.js
 * - test/built-ins/String/prototype/lastIndexOf/not-a-substring.js
 * - test/built-ins/String/prototype/slice/S15.5.4.13_A2_T8.js
 * - test/built-ins/String/prototype/substring/S15.5.4.15_A2_T8.js
 * - test/built-ins/String/prototype/split/call-split-l-2-instance-is-string-hello.js
 * - test/built-ins/String/prototype/repeat/repeat-string-n-times.js
 * - test/built-ins/String/prototype/padStart/normal-operation.js
 * - test/built-ins/String/prototype/padStart/max-length-not-greater-than-string.js
 * - test/built-ins/String/prototype/padEnd/normal-operation.js
 * - test/built-ins/String/prototype/at/returns-item-relative-index.js
 * - test/built-ins/String/prototype/at/returns-undefined-for-out-of-range-index.js
 * - test/built-ins/String/prototype/codePointAt/return-single-code-unit.js
 * - test/built-ins/String/prototype/codePointAt/return-utf16-decode.js
 * - test/built-ins/String/fromCharCode/S15.5.3.2_A2.js
 * - test/built-ins/String/fromCodePoint/return-string-value.js
 *
 * Copyright 2009 the Sputnik authors. All rights reserved.
 * Copyright (C) 2015 the V8 project authors. All rights reserved.
 * Copyright (C) 2016 Jordan Harband. All rights reserved.
 * Copyright (C) 2020 Rick Waldron. All rights reserved.
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

describe("Test262-adapted String behavior", () => {
  test("search methods honor positions and missing substrings", async () => {
    expect(
      await value(`
        const text = "The future is cool!"
        return [
          text.includes(" is ", 1),
          text.startsWith("future", 4),
          text.endsWith("future", 10),
          "$$abcdabcd".indexOf("ab", NaN),
          "abc".lastIndexOf("d"),
        ]
      `),
    ).toEqual([true, true, true, 2, -1])
  })

  test("slice and substring differ when their bounds are reversed", async () => {
    expect(
      await value(`
        const text = "this is a string object"
        return [text.slice(text.length + 1, 0), text.substring(text.length + 1, 0)]
      `),
    ).toEqual(["", "this is a string object"])
  })

  test("split honors a string separator and result limit", async () => {
    expect(await value(`return "hello".split("l", 2)`)).toEqual(["he", ""])
  })

  test("repeat creates the requested number of copies", async () => {
    expect(await value(`return ["abc".repeat(1), "abc".repeat(3), ".".repeat(10000).length]`)).toEqual([
      "abc",
      "abcabcabc",
      10000,
    ])
  })

  test("padding repeats and truncates fill strings by UTF-16 code unit", async () => {
    expect(
      await value(`
        return [
          "abc".padStart(7, "def"),
          "abc".padEnd(7, "def"),
          "abc".padStart(6, "\uD83D\uDCA9"),
          "abc".padStart(3, "def"),
        ]
      `),
    ).toEqual(["defdabc", "abcdefd", "\uD83D\uDCA9\uD83Dabc", "abc"])
  })

  test("at supports relative indexes and returns undefined out of range", async () => {
    expect(
      await value(`
        const text = "12345"
        return [text.at(0), text.at(-1), text.at(-3), "".at(-2) === undefined, "".at(0) === undefined]
      `),
    ).toEqual(["1", "5", "3", true, true])
  })

  test("codePointAt decodes single code units and surrogate pairs", async () => {
    expect(
      await value(`
        return [
          "abc".codePointAt(0),
          "\uAAAA\uBBBB".codePointAt(0),
          "123\uD800".codePointAt(3),
          "\uD800\uDC00".codePointAt(0),
          "\uDBFF\uDFFF".codePointAt(0),
        ]
      `),
    ).toEqual([97, 0xaaaa, 0xd800, 0x10000, 0x10ffff])
  })

  test("String creates text from code units and code points", async () => {
    expect(
      await value(`
        return [
          String.fromCharCode(),
          String.fromCodePoint(42),
          String.fromCodePoint(65, 90),
          String.fromCodePoint(0x2F804),
          String.fromCodePoint(0x1D306, 0x61, 0x1D307),
        ]
      `),
    ).toEqual(["", "*", "AZ", "\uD87E\uDC04", "\uD834\uDF06a\uD834\uDF07"])
  })
})
