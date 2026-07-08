/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/built-ins/String/prototype/toLowerCase/S15.5.4.16_A2_T1.js
 * - test/built-ins/String/prototype/toLowerCase/special_casing.js
 * - test/built-ins/String/prototype/toLowerCase/special_casing_conditional.js
 * - test/built-ins/String/prototype/toLowerCase/Final_Sigma_U180E.js
 * - test/built-ins/String/prototype/toLowerCase/supplementary_plane.js
 * - test/built-ins/String/prototype/toUpperCase/S15.5.4.18_A2_T1.js
 * - test/built-ins/String/prototype/toUpperCase/special_casing.js
 * - test/built-ins/String/prototype/toUpperCase/supplementary_plane.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-3-1.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-3-2.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-3-3.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-3-4.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-3-5.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-3-6.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-3-7.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-3-8.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-3-9.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-3-10.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-3-11.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-3-12.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-3-13.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-3-14.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-1.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-2.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-3.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-4.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-5.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-6.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-8.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-10.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-11.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-12.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-13.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-14.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-16.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-18.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-19.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-20.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-21.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-22.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-24.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-27.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-28.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-29.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-30.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-32.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-34.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-35.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-36.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-37.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-38.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-39.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-40.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-41.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-42.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-43.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-44.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-45.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-46.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-47.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-48.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-49.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-50.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-51.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-52.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-53.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-54.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-55.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-56.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-57.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-58.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-59.js
 * - test/built-ins/String/prototype/trim/15.5.4.20-4-60.js
 * - test/built-ins/String/prototype/trim/u180e.js
 * - test/built-ins/String/prototype/trimStart/this-value-whitespace.js
 * - test/built-ins/String/prototype/trimStart/this-value-line-terminator.js
 * - test/built-ins/String/prototype/trimEnd/this-value-whitespace.js
 * - test/built-ins/String/prototype/trimEnd/this-value-line-terminator.js
 * - test/built-ins/String/prototype/repeat/repeat-string-n-times.js
 * - test/built-ins/String/prototype/repeat/empty-string-returns-empty.js
 * - test/built-ins/String/prototype/repeat/count-is-zero-returns-empty-string.js
 * - test/built-ins/String/prototype/repeat/count-coerced-to-zero-returns-empty-string.js
 * - test/built-ins/String/prototype/padStart/fill-string-empty.js
 * - test/built-ins/String/prototype/padStart/normal-operation.js
 * - test/built-ins/String/prototype/padStart/fill-string-omitted.js
 * - test/built-ins/String/prototype/padStart/max-length-not-greater-than-string.js
 * - test/built-ins/String/prototype/padEnd/fill-string-empty.js
 * - test/built-ins/String/prototype/padEnd/normal-operation.js
 * - test/built-ins/String/prototype/padEnd/fill-string-omitted.js
 * - test/built-ins/String/prototype/padEnd/max-length-not-greater-than-string.js
 * - test/built-ins/String/prototype/charAt/S15.5.4.4_A1_T4.js
 * - test/built-ins/String/prototype/charAt/S15.5.4.4_A1_T7.js
 * - test/built-ins/String/prototype/charAt/S15.5.4.4_A1_T8.js
 * - test/built-ins/String/prototype/charAt/S15.5.4.4_A4_T1.js
 * - test/built-ins/String/prototype/charAt/S15.5.4.4_A4_T2.js
 * - test/built-ins/String/prototype/charAt/S15.5.4.4_A4_T3.js
 * - test/built-ins/String/prototype/charAt/S9.4_A1.js
 * - test/built-ins/String/prototype/charAt/S9.4_A2.js
 * - test/built-ins/String/prototype/charAt/pos-rounding.js
 * - test/built-ins/String/prototype/charCodeAt/S15.5.4.5_A1_T4.js
 * - test/built-ins/String/prototype/charCodeAt/S15.5.4.5_A1_T7.js
 * - test/built-ins/String/prototype/charCodeAt/S15.5.4.5_A1_T8.js
 * - test/built-ins/String/prototype/charCodeAt/pos-rounding.js
 * - test/built-ins/String/prototype/codePointAt/return-single-code-unit.js
 * - test/built-ins/String/prototype/codePointAt/return-first-code-unit.js
 * - test/built-ins/String/prototype/codePointAt/return-utf16-decode.js
 * - test/built-ins/String/prototype/codePointAt/return-code-unit-coerced-position.js
 * - test/built-ins/String/prototype/codePointAt/returns-undefined-on-position-less-than-zero.js
 * - test/built-ins/String/prototype/codePointAt/returns-undefined-on-position-equal-or-more-than-size.js
 * - test/built-ins/String/prototype/at/returns-code-unit.js
 * - test/built-ins/String/prototype/at/returns-item.js
 * - test/built-ins/String/prototype/at/returns-item-relative-index.js
 * - test/built-ins/String/prototype/at/returns-undefined-for-out-of-range-index.js
 * - test/built-ins/String/prototype/at/index-non-numeric-argument-tointeger.js
 * - test/built-ins/String/prototype/concat/S15.5.4.6_A1_T4.js
 * - test/built-ins/String/prototype/toString/string-primitive.js
 * - test/built-ins/String/prototype/normalize/return-normalized-string.js
 * - test/built-ins/String/prototype/normalize/return-normalized-string-using-default-parameter.js
 * - test/built-ins/String/prototype/normalize/form-is-not-valid-throws.js
 * - test/built-ins/String/prototype/localeCompare/15.5.4.9_CE.js
 * - test/built-ins/String/fromCharCode/S15.5.3.2_A2.js
 * - test/built-ins/String/fromCharCode/S15.5.3.2_A3_T1.js
 * - test/built-ins/String/fromCharCode/S9.7_A1.js
 * - test/built-ins/String/fromCharCode/S9.7_A2.1.js
 * - test/built-ins/String/fromCharCode/S9.7_A2.2.js
 * - test/built-ins/String/fromCharCode/S9.7_A3.2_T1.js
 * - test/built-ins/String/fromCodePoint/arguments-is-empty.js
 * - test/built-ins/String/fromCodePoint/return-string-value.js
 * - test/built-ins/String/fromCodePoint/argument-is-not-integer.js
 * - test/built-ins/String/fromCodePoint/number-is-out-of-range.js
 *
 * Copyright 2009 the Sputnik authors.  All rights reserved.
 * Copyright (C) 2009 the Sputnik authors. All rights reserved.
 * Copyright (c) 2012 Ecma International.  All rights reserved.
 * Copyright 2012 Norbert Lindenberg. All rights reserved.
 * Copyright 2012 Mozilla Corporation. All rights reserved.
 * Copyright 2013 Microsoft Corporation. All rights reserved.
 * Copyright (C) 2015 the V8 project authors. All rights reserved.
 * Copyright (C) 2015 André Bargull. All rights reserved.
 * Copyright (C) 2016 the V8 project authors. All rights reserved.
 * Copyright (C) 2016 André Bargull. All rights reserved.
 * Copyright (C) 2016 Jordan Harband. All rights reserved.
 * Copyright (C) 2016 Mathias Bynens. All rights reserved.
 * Copyright (c) 2017 Valerie Young.  All rights reserved.
 * Copyright (C) 2017 Valerie Young. All rights reserved.
 * Copyright (C) 2020 Rick Waldron. All rights reserved.
 * Copyright (C) 2022 Richard Gibson. All rights reserved.
 * Test262 portions are governed by the BSD license in LICENSE.test262.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../src/index.js"

type Argument = string | number | undefined
type Outcome = "undefined" | "length" | "RangeError"
type Assertion = {
  label: string
  input?: string
  args?: ReadonlyArray<Argument>
  expected?: string | number
  outcome?: Outcome
}
type Vector = {
  path: string
  method: string
  static?: boolean
  assertions: ReadonlyArray<Assertion>
}

const value = async (code: string) => {
  const result = await Effect.runPromise(CodeMode.execute({ code, tools: {} }))
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

const literal = (input: Argument) => {
  if (input === undefined) return "undefined"
  if (typeof input === "string") return JSON.stringify(input)
  if (Number.isNaN(input)) return "NaN"
  if (input === Infinity) return "Infinity"
  if (input === -Infinity) return "-Infinity"
  if (Object.is(input, -0)) return "-0"
  return JSON.stringify(input)
}

const vectors: Array<Vector> = []
const add = (path: string, method: string, assertions: ReadonlyArray<Assertion>, staticMethod = false) => {
  vectors.push({ path, method, assertions, static: staticMethod })
}
const assertion = (label: string, input: string, expected: string | number, args: ReadonlyArray<Argument> = []) => ({
  label,
  input,
  args,
  expected,
})

add("test/built-ins/String/prototype/toLowerCase/S15.5.4.16_A2_T1.js", "toLowerCase", [
  assertion("#1 direct value", "Hello, WoRlD!", "hello, world!"),
  assertion("#2 String value", "Hello, WoRlD!", "hello, world!"),
])
add("test/built-ins/String/prototype/toLowerCase/special_casing.js", "toLowerCase", [
  assertion(
    "103 SpecialCasing mappings",
    "\u00DF\u0130\uFB00\uFB01\uFB02\uFB03\uFB04\uFB05\uFB06\u0587\uFB13\uFB14\uFB15\uFB16\uFB17\u0149\u0390\u03B0\u01F0\u1E96\u1E97\u1E98\u1E99\u1E9A\u1F50\u1F52\u1F54\u1F56\u1FB6\u1FC6\u1FD2\u1FD3\u1FD6\u1FD7\u1FE2\u1FE3\u1FE4\u1FE6\u1FE7\u1FF6\u1F80\u1F81\u1F82\u1F83\u1F84\u1F85\u1F86\u1F87\u1F88\u1F89\u1F8A\u1F8B\u1F8C\u1F8D\u1F8E\u1F8F\u1F90\u1F91\u1F92\u1F93\u1F94\u1F95\u1F96\u1F97\u1F98\u1F99\u1F9A\u1F9B\u1F9C\u1F9D\u1F9E\u1F9F\u1FA0\u1FA1\u1FA2\u1FA3\u1FA4\u1FA5\u1FA6\u1FA7\u1FA8\u1FA9\u1FAA\u1FAB\u1FAC\u1FAD\u1FAE\u1FAF\u1FB3\u1FBC\u1FC3\u1FCC\u1FF3\u1FFC\u1FB2\u1FB4\u1FC2\u1FC4\u1FF2\u1FF4\u1FB7\u1FC7\u1FF7",
    "\u00DF\u0069\u0307\uFB00\uFB01\uFB02\uFB03\uFB04\uFB05\uFB06\u0587\uFB13\uFB14\uFB15\uFB16\uFB17\u0149\u0390\u03B0\u01F0\u1E96\u1E97\u1E98\u1E99\u1E9A\u1F50\u1F52\u1F54\u1F56\u1FB6\u1FC6\u1FD2\u1FD3\u1FD6\u1FD7\u1FE2\u1FE3\u1FE4\u1FE6\u1FE7\u1FF6\u1F80\u1F81\u1F82\u1F83\u1F84\u1F85\u1F86\u1F87\u1F80\u1F81\u1F82\u1F83\u1F84\u1F85\u1F86\u1F87\u1F90\u1F91\u1F92\u1F93\u1F94\u1F95\u1F96\u1F97\u1F90\u1F91\u1F92\u1F93\u1F94\u1F95\u1F96\u1F97\u1FA0\u1FA1\u1FA2\u1FA3\u1FA4\u1FA5\u1FA6\u1FA7\u1FA0\u1FA1\u1FA2\u1FA3\u1FA4\u1FA5\u1FA6\u1FA7\u1FB3\u1FB3\u1FC3\u1FC3\u1FF3\u1FF3\u1FB2\u1FB4\u1FC2\u1FC4\u1FF2\u1FF4\u1FB7\u1FC7\u1FF7",
  ),
])
add("test/built-ins/String/prototype/toLowerCase/special_casing_conditional.js", "toLowerCase", [
  assertion("single sigma", "\u03A3", "\u03C3"),
  assertion("preceded by cased", "A\u03A3", "a\u03C2"),
  assertion("preceded by supplementary cased", "\uD835\uDCA2\u03A3", "\uD835\uDCA2\u03C2"),
  assertion("preceded by full stop", "A.\u03A3", "a.\u03C2"),
  assertion("preceded by soft hyphen", "A\u00AD\u03A3", "a\u00AD\u03C2"),
  assertion("preceded by combining mark", "A\uD834\uDE42\u03A3", "a\uD834\uDE42\u03C2"),
  assertion("preceded by uncased combining mark", "\u0345\u03A3", "\u0345\u03C3"),
  assertion("preceded by cased and combining mark", "\u0391\u0345\u03A3", "\u03B1\u0345\u03C2"),
  assertion("followed by cased", "A\u03A3B", "a\u03C3b"),
  assertion("followed by supplementary cased", "A\u03A3\uD835\uDCA2", "a\u03C3\uD835\uDCA2"),
  assertion("followed by full stop and cased", "A\u03A3.b", "a\u03C3.b"),
  assertion("followed by soft hyphen and cased", "A\u03A3\u00ADB", "a\u03C3\u00ADb"),
  assertion("followed by combining mark and cased", "A\u03A3\uD834\uDE42B", "a\u03C3\uD834\uDE42b"),
  assertion("followed by uncased combining mark", "A\u03A3\u0345", "a\u03C2\u0345"),
  assertion("followed by combining mark and cased Greek", "A\u03A3\u0345\u0391", "a\u03C3\u0345\u03B1"),
])
add("test/built-ins/String/prototype/toLowerCase/Final_Sigma_U180E.js", "toLowerCase", [
  assertion("preceded by U+180E", "A\u180E\u03A3", "a\u180E\u03C2"),
  assertion("preceded by U+180E and followed by cased", "A\u180E\u03A3B", "a\u180E\u03C3b"),
  assertion("followed by U+180E", "A\u03A3\u180E", "a\u03C2\u180E"),
  assertion("followed by U+180E and cased", "A\u03A3\u180EB", "a\u03C3\u180Eb"),
  assertion("surrounded by U+180E", "A\u180E\u03A3\u180E", "a\u180E\u03C2\u180E"),
  assertion("surrounded by U+180E and followed by cased", "A\u180E\u03A3\u180EB", "a\u180E\u03C3\u180Eb"),
])
add("test/built-ins/String/prototype/toLowerCase/supplementary_plane.js", "toLowerCase", [
  assertion(
    "40 Deseret mappings",
    "\uD801\uDC00\uD801\uDC01\uD801\uDC02\uD801\uDC03\uD801\uDC04\uD801\uDC05\uD801\uDC06\uD801\uDC07\uD801\uDC08\uD801\uDC09\uD801\uDC0A\uD801\uDC0B\uD801\uDC0C\uD801\uDC0D\uD801\uDC0E\uD801\uDC0F\uD801\uDC10\uD801\uDC11\uD801\uDC12\uD801\uDC13\uD801\uDC14\uD801\uDC15\uD801\uDC16\uD801\uDC17\uD801\uDC18\uD801\uDC19\uD801\uDC1A\uD801\uDC1B\uD801\uDC1C\uD801\uDC1D\uD801\uDC1E\uD801\uDC1F\uD801\uDC20\uD801\uDC21\uD801\uDC22\uD801\uDC23\uD801\uDC24\uD801\uDC25\uD801\uDC26\uD801\uDC27",
    "\uD801\uDC28\uD801\uDC29\uD801\uDC2A\uD801\uDC2B\uD801\uDC2C\uD801\uDC2D\uD801\uDC2E\uD801\uDC2F\uD801\uDC30\uD801\uDC31\uD801\uDC32\uD801\uDC33\uD801\uDC34\uD801\uDC35\uD801\uDC36\uD801\uDC37\uD801\uDC38\uD801\uDC39\uD801\uDC3A\uD801\uDC3B\uD801\uDC3C\uD801\uDC3D\uD801\uDC3E\uD801\uDC3F\uD801\uDC40\uD801\uDC41\uD801\uDC42\uD801\uDC43\uD801\uDC44\uD801\uDC45\uD801\uDC46\uD801\uDC47\uD801\uDC48\uD801\uDC49\uD801\uDC4A\uD801\uDC4B\uD801\uDC4C\uD801\uDC4D\uD801\uDC4E\uD801\uDC4F",
  ),
])
add("test/built-ins/String/prototype/toUpperCase/S15.5.4.18_A2_T1.js", "toUpperCase", [
  assertion("#1 direct value", "Hello, WoRlD!", "HELLO, WORLD!"),
  assertion("#2 String value", "Hello, WoRlD!", "HELLO, WORLD!"),
])
add("test/built-ins/String/prototype/toUpperCase/special_casing.js", "toUpperCase", [
  assertion(
    "103 SpecialCasing mappings",
    "\u00DF\u0130\uFB00\uFB01\uFB02\uFB03\uFB04\uFB05\uFB06\u0587\uFB13\uFB14\uFB15\uFB16\uFB17\u0149\u0390\u03B0\u01F0\u1E96\u1E97\u1E98\u1E99\u1E9A\u1F50\u1F52\u1F54\u1F56\u1FB6\u1FC6\u1FD2\u1FD3\u1FD6\u1FD7\u1FE2\u1FE3\u1FE4\u1FE6\u1FE7\u1FF6\u1F80\u1F81\u1F82\u1F83\u1F84\u1F85\u1F86\u1F87\u1F88\u1F89\u1F8A\u1F8B\u1F8C\u1F8D\u1F8E\u1F8F\u1F90\u1F91\u1F92\u1F93\u1F94\u1F95\u1F96\u1F97\u1F98\u1F99\u1F9A\u1F9B\u1F9C\u1F9D\u1F9E\u1F9F\u1FA0\u1FA1\u1FA2\u1FA3\u1FA4\u1FA5\u1FA6\u1FA7\u1FA8\u1FA9\u1FAA\u1FAB\u1FAC\u1FAD\u1FAE\u1FAF\u1FB3\u1FBC\u1FC3\u1FCC\u1FF3\u1FFC\u1FB2\u1FB4\u1FC2\u1FC4\u1FF2\u1FF4\u1FB7\u1FC7\u1FF7",
    "\u0053\u0053\u0130\u0046\u0046\u0046\u0049\u0046\u004C\u0046\u0046\u0049\u0046\u0046\u004C\u0053\u0054\u0053\u0054\u0535\u0552\u0544\u0546\u0544\u0535\u0544\u053B\u054E\u0546\u0544\u053D\u02BC\u004E\u0399\u0308\u0301\u03A5\u0308\u0301\u004A\u030C\u0048\u0331\u0054\u0308\u0057\u030A\u0059\u030A\u0041\u02BE\u03A5\u0313\u03A5\u0313\u0300\u03A5\u0313\u0301\u03A5\u0313\u0342\u0391\u0342\u0397\u0342\u0399\u0308\u0300\u0399\u0308\u0301\u0399\u0342\u0399\u0308\u0342\u03A5\u0308\u0300\u03A5\u0308\u0301\u03A1\u0313\u03A5\u0342\u03A5\u0308\u0342\u03A9\u0342\u1F08\u0399\u1F09\u0399\u1F0A\u0399\u1F0B\u0399\u1F0C\u0399\u1F0D\u0399\u1F0E\u0399\u1F0F\u0399\u1F08\u0399\u1F09\u0399\u1F0A\u0399\u1F0B\u0399\u1F0C\u0399\u1F0D\u0399\u1F0E\u0399\u1F0F\u0399\u1F28\u0399\u1F29\u0399\u1F2A\u0399\u1F2B\u0399\u1F2C\u0399\u1F2D\u0399\u1F2E\u0399\u1F2F\u0399\u1F28\u0399\u1F29\u0399\u1F2A\u0399\u1F2B\u0399\u1F2C\u0399\u1F2D\u0399\u1F2E\u0399\u1F2F\u0399\u1F68\u0399\u1F69\u0399\u1F6A\u0399\u1F6B\u0399\u1F6C\u0399\u1F6D\u0399\u1F6E\u0399\u1F6F\u0399\u1F68\u0399\u1F69\u0399\u1F6A\u0399\u1F6B\u0399\u1F6C\u0399\u1F6D\u0399\u1F6E\u0399\u1F6F\u0399\u0391\u0399\u0391\u0399\u0397\u0399\u0397\u0399\u03A9\u0399\u03A9\u0399\u1FBA\u0399\u0386\u0399\u1FCA\u0399\u0389\u0399\u1FFA\u0399\u038F\u0399\u0391\u0342\u0399\u0397\u0342\u0399\u03A9\u0342\u0399",
  ),
])
add("test/built-ins/String/prototype/toUpperCase/supplementary_plane.js", "toUpperCase", [
  assertion(
    "40 Deseret mappings",
    "\uD801\uDC28\uD801\uDC29\uD801\uDC2A\uD801\uDC2B\uD801\uDC2C\uD801\uDC2D\uD801\uDC2E\uD801\uDC2F\uD801\uDC30\uD801\uDC31\uD801\uDC32\uD801\uDC33\uD801\uDC34\uD801\uDC35\uD801\uDC36\uD801\uDC37\uD801\uDC38\uD801\uDC39\uD801\uDC3A\uD801\uDC3B\uD801\uDC3C\uD801\uDC3D\uD801\uDC3E\uD801\uDC3F\uD801\uDC40\uD801\uDC41\uD801\uDC42\uD801\uDC43\uD801\uDC44\uD801\uDC45\uD801\uDC46\uD801\uDC47\uD801\uDC48\uD801\uDC49\uD801\uDC4A\uD801\uDC4B\uD801\uDC4C\uD801\uDC4D\uD801\uDC4E\uD801\uDC4F",
    "\uD801\uDC00\uD801\uDC01\uD801\uDC02\uD801\uDC03\uD801\uDC04\uD801\uDC05\uD801\uDC06\uD801\uDC07\uD801\uDC08\uD801\uDC09\uD801\uDC0A\uD801\uDC0B\uD801\uDC0C\uD801\uDC0D\uD801\uDC0E\uD801\uDC0F\uD801\uDC10\uD801\uDC11\uD801\uDC12\uD801\uDC13\uD801\uDC14\uD801\uDC15\uD801\uDC16\uD801\uDC17\uD801\uDC18\uD801\uDC19\uD801\uDC1A\uD801\uDC1B\uD801\uDC1C\uD801\uDC1D\uD801\uDC1E\uD801\uDC1F\uD801\uDC20\uD801\uDC21\uD801\uDC22\uD801\uDC23\uD801\uDC24\uD801\uDC25\uD801\uDC26\uD801\uDC27",
  ),
])

const whitespace = "\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"
const lineTerminators = "\u000A\u000D\u2028\u2029"
const trim = (file: string, input: string, expected: string) =>
  add(`test/built-ins/String/prototype/trim/${file}`, "trim", [assertion("upstream assertion", input, expected)])

trim("15.5.4.20-3-1.js", lineTerminators, "")
trim("15.5.4.20-3-2.js", whitespace, "")
trim("15.5.4.20-3-3.js", whitespace + lineTerminators, "")
trim("15.5.4.20-3-4.js", whitespace + lineTerminators + "abc", "abc")
trim("15.5.4.20-3-5.js", "abc" + whitespace + lineTerminators, "abc")
trim("15.5.4.20-3-6.js", whitespace + lineTerminators + "abc" + whitespace + lineTerminators, "abc")
trim("15.5.4.20-3-7.js", "ab" + whitespace + lineTerminators + "cd", "ab" + whitespace + lineTerminators + "cd")
trim("15.5.4.20-3-8.js", "\0\u0000", "\0\u0000")
trim("15.5.4.20-3-9.js", "\0", "\0")
trim("15.5.4.20-3-10.js", "\u0000", "\u0000")
trim("15.5.4.20-3-11.js", "\0\u0000abc", "\0\u0000abc")
trim("15.5.4.20-3-12.js", "abc\0\u0000", "abc\0\u0000")
trim("15.5.4.20-3-13.js", "\0\u0000abc\0\u0000", "\0\u0000abc\0\u0000")
trim("15.5.4.20-3-14.js", "a\0\u0000bc", "a\0\u0000bc")
trim("15.5.4.20-4-1.js", "\u0009a bc \u0009", "a bc")
trim("15.5.4.20-4-2.js", " \u0009abc \u0009", "abc")
trim("15.5.4.20-4-3.js", "\u0009abc", "abc")
trim("15.5.4.20-4-4.js", "\u000Babc", "abc")
trim("15.5.4.20-4-5.js", "\u000Cabc", "abc")
trim("15.5.4.20-4-6.js", "\u0020abc", "abc")
trim("15.5.4.20-4-8.js", "\u00A0abc", "abc")
trim("15.5.4.20-4-10.js", "\uFEFFabc", "abc")
trim("15.5.4.20-4-11.js", "abc\u0009", "abc")
trim("15.5.4.20-4-12.js", "abc\u000B", "abc")
trim("15.5.4.20-4-13.js", "abc\u000C", "abc")
trim("15.5.4.20-4-14.js", "abc\u0020", "abc")
trim("15.5.4.20-4-16.js", "abc\u00A0", "abc")
trim("15.5.4.20-4-18.js", "abc\uFEFF", "abc")
trim("15.5.4.20-4-19.js", "\u0009abc\u0009", "abc")
trim("15.5.4.20-4-20.js", "\u000Babc\u000B", "abc")
trim("15.5.4.20-4-21.js", "\u000Cabc\u000C", "abc")
trim("15.5.4.20-4-22.js", "\u0020abc\u0020", "abc")
trim("15.5.4.20-4-24.js", "\u00A0abc\u00A0", "abc")
trim("15.5.4.20-4-27.js", "\u0009\u0009", "")
trim("15.5.4.20-4-28.js", "\u000B\u000B", "")
trim("15.5.4.20-4-29.js", "\u000C\u000C", "")
trim("15.5.4.20-4-30.js", "\u0020\u0020", "")
trim("15.5.4.20-4-32.js", "\u00A0\u00A0", "")
trim("15.5.4.20-4-34.js", "\uFEFF\uFEFF", "")
trim("15.5.4.20-4-35.js", "ab\u0009c", "ab\u0009c")
trim("15.5.4.20-4-36.js", "ab\u000Bc", "ab\u000Bc")
trim("15.5.4.20-4-37.js", "ab\u000Cc", "ab\u000Cc")
trim("15.5.4.20-4-38.js", "ab\u0020c", "ab\u0020c")
trim("15.5.4.20-4-39.js", "ab\u0085c", "ab\u0085c")
trim("15.5.4.20-4-40.js", "ab\u00A0c", "ab\u00A0c")
trim("15.5.4.20-4-41.js", "ab\u200Bc", "ab\u200Bc")
trim("15.5.4.20-4-42.js", "ab\uFEFFc", "ab\uFEFFc")
trim("15.5.4.20-4-43.js", "\u000Aabc", "abc")
trim("15.5.4.20-4-44.js", "\u000Dabc", "abc")
trim("15.5.4.20-4-45.js", "\u2028abc", "abc")
trim("15.5.4.20-4-46.js", "\u2029abc", "abc")
trim("15.5.4.20-4-47.js", "abc\u000A", "abc")
trim("15.5.4.20-4-48.js", "abc\u000D", "abc")
trim("15.5.4.20-4-49.js", "abc\u2028", "abc")
trim("15.5.4.20-4-50.js", "abc\u2029", "abc")
trim("15.5.4.20-4-51.js", "\u000Aabc\u000A", "abc")
trim("15.5.4.20-4-52.js", "\u000Dabc\u000D", "abc")
trim("15.5.4.20-4-53.js", "\u2028abc\u2028", "abc")
trim("15.5.4.20-4-54.js", "\u2029abc\u2029", "abc")
trim("15.5.4.20-4-55.js", "\u000A\u000A", "")
trim("15.5.4.20-4-56.js", "\u000D\u000D", "")
trim("15.5.4.20-4-57.js", "\u2028\u2028", "")
trim("15.5.4.20-4-58.js", "\u2029\u2029", "")
trim("15.5.4.20-4-59.js", "\u2029           abc", "abc")
trim("15.5.4.20-4-60.js", "    ", "")
add("test/built-ins/String/prototype/trim/u180e.js", "trim", [
  assertion("trailing U+180E", "_\u180E", "_\u180E"),
  assertion("only U+180E", "\u180E", "\u180E"),
  assertion("leading U+180E", "\u180E_", "\u180E_"),
])

const directionalWhitespace = "\x09\x0A\x0B\x0C\x0D\x20\xA0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\u2028\u2029\uFEFF"
add("test/built-ins/String/prototype/trimStart/this-value-whitespace.js", "trimStart", [
  assertion("all whitespace", directionalWhitespace + "a" + directionalWhitespace + "b" + directionalWhitespace, "a" + directionalWhitespace + "b" + directionalWhitespace),
])
add("test/built-ins/String/prototype/trimStart/this-value-line-terminator.js", "trimStart", [
  assertion("all line terminators", lineTerminators + "a" + lineTerminators + "b" + lineTerminators, "a" + lineTerminators + "b" + lineTerminators),
])
add("test/built-ins/String/prototype/trimEnd/this-value-whitespace.js", "trimEnd", [
  assertion("all whitespace", directionalWhitespace + "a" + directionalWhitespace + "b" + directionalWhitespace, directionalWhitespace + "a" + directionalWhitespace + "b"),
])
add("test/built-ins/String/prototype/trimEnd/this-value-line-terminator.js", "trimEnd", [
  assertion("all line terminators", lineTerminators + "a" + lineTerminators + "b" + lineTerminators, lineTerminators + "a" + lineTerminators + "b"),
])
add("test/built-ins/String/prototype/repeat/repeat-string-n-times.js", "repeat", [
  assertion("repeat once", "abc", "abc", [1]),
  assertion("repeat three times", "abc", "abcabcabc", [3]),
  { label: "repeat 10000 times length", input: ".", args: [10000], expected: 10000, outcome: "length" },
])
add("test/built-ins/String/prototype/repeat/empty-string-returns-empty.js", "repeat", [
  assertion("count 1", "", "", [1]),
  assertion("count 3", "", "", [3]),
  assertion("maximum 32-bit count", "", "", [0xffffffff]),
])
add("test/built-ins/String/prototype/repeat/count-is-zero-returns-empty-string.js", "repeat", [
  assertion("zero", "foo", "", [0]),
])
add("test/built-ins/String/prototype/repeat/count-coerced-to-zero-returns-empty-string.js", "repeat", [
  assertion("fraction truncates to zero", "abc", "", [0.9]),
])
add("test/built-ins/String/prototype/padStart/fill-string-empty.js", "padStart", [assertion("empty fill", "abc", "abc", [5, ""])])
add("test/built-ins/String/prototype/padStart/normal-operation.js", "padStart", [
  assertion("truncated multi-character fill", "abc", "defdabc", [7, "def"]),
  assertion("single-character fill", "abc", "**abc", [5, "*"]),
  assertion("truncated surrogate pair", "abc", "\uD83D\uDCA9\uD83Dabc", [6, "\uD83D\uDCA9"]),
])
add("test/built-ins/String/prototype/padStart/fill-string-omitted.js", "padStart", [
  assertion("omitted fill", "abc", "  abc", [5]),
  assertion("undefined fill", "abc", "  abc", [5, undefined]),
])
add("test/built-ins/String/prototype/padStart/max-length-not-greater-than-string.js", "padStart", [
  assertion("NaN", "abc", "abc", [NaN, "def"]),
  assertion("negative infinity", "abc", "abc", [-Infinity, "def"]),
  assertion("zero", "abc", "abc", [0, "def"]),
  assertion("negative one", "abc", "abc", [-1, "def"]),
  assertion("equal length", "abc", "abc", [3, "def"]),
  assertion("fraction truncates", "abc", "abc", [3.9999, "def"]),
])
add("test/built-ins/String/prototype/padEnd/fill-string-empty.js", "padEnd", [assertion("empty fill", "abc", "abc", [5, ""])])
add("test/built-ins/String/prototype/padEnd/normal-operation.js", "padEnd", [
  assertion("truncated multi-character fill", "abc", "abcdefd", [7, "def"]),
  assertion("single-character fill", "abc", "abc**", [5, "*"]),
  assertion("truncated surrogate pair", "abc", "abc\uD83D\uDCA9\uD83D", [6, "\uD83D\uDCA9"]),
])
add("test/built-ins/String/prototype/padEnd/fill-string-omitted.js", "padEnd", [
  assertion("omitted fill", "abc", "abc  ", [5]),
  assertion("undefined fill", "abc", "abc  ", [5, undefined]),
])
add("test/built-ins/String/prototype/padEnd/max-length-not-greater-than-string.js", "padEnd", [
  assertion("NaN", "abc", "abc", [NaN, "def"]),
  assertion("negative infinity", "abc", "abc", [-Infinity, "def"]),
  assertion("zero", "abc", "abc", [0, "def"]),
  assertion("negative one", "abc", "abc", [-1, "def"]),
  assertion("equal length", "abc", "abc", [3, "def"]),
  assertion("fraction truncates", "abc", "abc", [3.9999, "def"]),
])

add("test/built-ins/String/prototype/charAt/S15.5.4.4_A1_T4.js", "charAt", [assertion("omitted position", "lego", "l")])
add("test/built-ins/String/prototype/charAt/S15.5.4.4_A1_T7.js", "charAt", [assertion("undefined position", "lego", "l", [undefined])])
add("test/built-ins/String/prototype/charAt/S15.5.4.4_A1_T8.js", "charAt", [assertion("undefined position", "42", "4", [undefined])])
add("test/built-ins/String/prototype/charAt/S15.5.4.4_A4_T1.js", "charAt", ["A", "B", "C", "A", "B", "C"].map((expected, position) => assertion(`position ${position}`, "ABCABC", expected, [position])))
add("test/built-ins/String/prototype/charAt/S15.5.4.4_A4_T2.js", "charAt", [-2, -1].map((position) => assertion(`position ${position}`, "ABCABC", "", [position])))
add("test/built-ins/String/prototype/charAt/S15.5.4.4_A4_T3.js", "charAt", [6, 7].map((position) => assertion(`position ${position}`, "ABCABC", "", [position])))
add("test/built-ins/String/prototype/charAt/S9.4_A1.js", "charAt", [assertion("NaN position", "abc", "a", [NaN])])
add("test/built-ins/String/prototype/charAt/S9.4_A2.js", "charAt", [
  assertion("positive zero", "abc", "a", [0]),
  assertion("negative zero", "abc", "a", [-0]),
])
add("test/built-ins/String/prototype/charAt/pos-rounding.js", "charAt", [
  assertion("-0.99999", "abc", "a", [-0.99999]),
  assertion("-0.00001", "abc", "a", [-0.00001]),
  assertion("0.00001", "abc", "a", [0.00001]),
  assertion("0.99999", "abc", "a", [0.99999]),
  assertion("1.00001", "abc", "b", [1.00001]),
  assertion("1.99999", "abc", "b", [1.99999]),
])

add("test/built-ins/String/prototype/charCodeAt/S15.5.4.5_A1_T4.js", "charCodeAt", [assertion("omitted position", "smart", 0x73)])
add("test/built-ins/String/prototype/charCodeAt/S15.5.4.5_A1_T7.js", "charCodeAt", [assertion("undefined position", "lego", 0x6c, [undefined])])
add("test/built-ins/String/prototype/charCodeAt/S15.5.4.5_A1_T8.js", "charCodeAt", [assertion("undefined position", "42", 0x34, [undefined])])
add("test/built-ins/String/prototype/charCodeAt/pos-rounding.js", "charCodeAt", [
  assertion("-0.99999", "abc", 0x61, [-0.99999]),
  assertion("-0.00001", "abc", 0x61, [-0.00001]),
  assertion("0.00001", "abc", 0x61, [0.00001]),
  assertion("0.99999", "abc", 0x61, [0.99999]),
  assertion("1.00001", "abc", 0x62, [1.00001]),
  assertion("1.99999", "abc", 0x62, [1.99999]),
])

add("test/built-ins/String/prototype/codePointAt/return-single-code-unit.js", "codePointAt", [
  assertion("a", "abc", 97, [0]), assertion("b", "abc", 98, [1]), assertion("c", "abc", 99, [2]),
  assertion("ordinary BMP", "\uAAAA\uBBBB", 0xaaaa, [0]), assertion("before high-surrogate range", "\uD7FF\uAAAA", 0xd7ff, [0]),
  assertion("low surrogate", "\uDC00\uAAAA", 0xdc00, [0]), assertion("trailing D800", "123\uD800", 0xd800, [3]),
  assertion("trailing DAAA", "123\uDAAA", 0xdaaa, [3]), assertion("trailing DBFF", "123\uDBFF", 0xdbff, [3]),
])
add("test/built-ins/String/prototype/codePointAt/return-first-code-unit.js", "codePointAt", [
  assertion("D800 before DBFF", "\uD800\uDBFF", 0xd800, [0]), assertion("D800 before E000", "\uD800\uE000", 0xd800, [0]),
  assertion("DAAA before DBFF", "\uDAAA\uDBFF", 0xdaaa, [0]), assertion("DAAA before E000", "\uDAAA\uE000", 0xdaaa, [0]),
  assertion("DBFF before DBFF", "\uDBFF\uDBFF", 0xdbff, [0]), assertion("DBFF before E000", "\uDBFF\uE000", 0xdbff, [0]),
  assertion("D800 before NUL", "\uD800\u0000", 0xd800, [0]), assertion("D800 before FFFF", "\uD800\uFFFF", 0xd800, [0]),
  assertion("DAAA before NUL", "\uDAAA\u0000", 0xdaaa, [0]), assertion("DAAA before FFFF", "\uDAAA\uFFFF", 0xdaaa, [0]),
  assertion("DBFF before FFFF", "\uDBFF\uFFFF", 0xdbff, [0]),
])
add("test/built-ins/String/prototype/codePointAt/return-utf16-decode.js", "codePointAt", [
  assertion("U+10000", "\uD800\uDC00", 65536, [0]), assertion("U+101D0", "\uD800\uDDD0", 66000, [0]),
  assertion("U+103FF", "\uD800\uDFFF", 66559, [0]), assertion("U+BA800", "\uDAAA\uDC00", 763904, [0]),
  assertion("U+BA9D0", "\uDAAA\uDDD0", 764368, [0]), assertion("U+BABFF", "\uDAAA\uDFFF", 764927, [0]),
  assertion("U+10FC00", "\uDBFF\uDC00", 1113088, [0]), assertion("U+10FDD0", "\uDBFF\uDDD0", 1113552, [0]),
  assertion("U+10FFFF", "\uDBFF\uDFFF", 1114111, [0]),
])
add("test/built-ins/String/prototype/codePointAt/return-code-unit-coerced-position.js", "codePointAt", [
  assertion("NaN", "\uD800\uDC00", 65536, [NaN]), assertion("undefined", "\uD800\uDC00", 65536, [undefined]),
])
add("test/built-ins/String/prototype/codePointAt/returns-undefined-on-position-less-than-zero.js", "codePointAt", [
  { label: "negative one", input: "abc", args: [-1], outcome: "undefined" },
  { label: "negative infinity", input: "abc", args: [-Infinity], outcome: "undefined" },
])
add("test/built-ins/String/prototype/codePointAt/returns-undefined-on-position-equal-or-more-than-size.js", "codePointAt", [
  { label: "equal to size", input: "abc", args: [3], outcome: "undefined" },
  { label: "greater than size", input: "abc", args: [4], outcome: "undefined" },
  { label: "positive infinity", input: "abc", args: [Infinity], outcome: "undefined" },
])

add("test/built-ins/String/prototype/at/returns-code-unit.js", "at", [
  assertion("position 0", "12\uD80034", "1", [0]), assertion("position 1", "12\uD80034", "2", [1]),
  assertion("unpaired surrogate", "12\uD80034", "\uD800", [2]), assertion("position 3", "12\uD80034", "3", [3]),
  assertion("position 4", "12\uD80034", "4", [4]),
])
add("test/built-ins/String/prototype/at/returns-item.js", "at", ["1", "2", "3", "4", "5"].map((expected, position) => assertion(`position ${position}`, "12345", expected, [position])))
add("test/built-ins/String/prototype/at/returns-item-relative-index.js", "at", [
  assertion("zero", "12345", "1", [0]), assertion("negative one", "12345", "5", [-1]),
  assertion("negative three", "12345", "3", [-3]), assertion("negative four", "12345", "2", [-4]),
])
add("test/built-ins/String/prototype/at/returns-undefined-for-out-of-range-index.js", "at", [-2, 0, 1].map((position) => ({ label: `position ${position}`, input: "", args: [position], outcome: "undefined" })))
add("test/built-ins/String/prototype/at/index-non-numeric-argument-tointeger.js", "at", [assertion("undefined", "01", "0", [undefined])])

add("test/built-ins/String/prototype/concat/S15.5.4.6_A1_T4.js", "concat", [assertion("no arguments", "lego", "lego")])
add("test/built-ins/String/prototype/toString/string-primitive.js", "toString", [
  assertion("empty string", "", ""), assertion("non-empty string", "str", "str"),
])

add("test/built-ins/String/prototype/normalize/return-normalized-string.js", "normalize", [
  assertion("NFC short", "\u1E9B\u0323", "\u1E9B\u0323", ["NFC"]),
  assertion("NFD short", "\u1E9B\u0323", "\u017F\u0323\u0307", ["NFD"]),
  assertion("NFKC short", "\u1E9B\u0323", "\u1E69", ["NFKC"]),
  assertion("NFKD short", "\u1E9B\u0323", "\u0073\u0323\u0307", ["NFKD"]),
  assertion("NFC long", "\u00C5\u2ADC\u0958\u2126\u0344", "\xC5\u2ADD\u0338\u0915\u093C\u03A9\u0308\u0301", ["NFC"]),
  assertion("NFD long", "\u00C5\u2ADC\u0958\u2126\u0344", "A\u030A\u2ADD\u0338\u0915\u093C\u03A9\u0308\u0301", ["NFD"]),
  assertion("NFKC long", "\u00C5\u2ADC\u0958\u2126\u0344", "\xC5\u2ADD\u0338\u0915\u093C\u03A9\u0308\u0301", ["NFKC"]),
  assertion("NFKD long", "\u00C5\u2ADC\u0958\u2126\u0344", "A\u030A\u2ADD\u0338\u0915\u093C\u03A9\u0308\u0301", ["NFKD"]),
])
add("test/built-ins/String/prototype/normalize/return-normalized-string-using-default-parameter.js", "normalize", [
  assertion("omitted", "\u00C5\u2ADC\u0958\u2126\u0344", "\xC5\u2ADD\u0338\u0915\u093C\u03A9\u0308\u0301"),
  assertion("undefined", "\u00C5\u2ADC\u0958\u2126\u0344", "\xC5\u2ADD\u0338\u0915\u093C\u03A9\u0308\u0301", [undefined]),
])
add("test/built-ins/String/prototype/normalize/form-is-not-valid-throws.js", "normalize", [
  { label: "bar", input: "foo", args: ["bar"], outcome: "RangeError" },
  { label: "NFC1", input: "foo", args: ["NFC1"], outcome: "RangeError" },
])

add("test/built-ins/String/prototype/localeCompare/15.5.4.9_CE.js", "localeCompare", [
  assertion("D70", "o\u0308", 0, ["ö"]), assertion("reordered diaeresis", "ä\u0323", 0, ["a\u0323\u0308"]),
  assertion("reordered marks", "a\u0308\u0323", 0, ["a\u0323\u0308"]), assertion("precomposed dot below", "ạ\u0308", 0, ["a\u0323\u0308"]),
  assertion("breve after diaeresis", "ä\u0306", 0, ["a\u0308\u0306"]), assertion("diaeresis after breve", "ă\u0308", 0, ["a\u0306\u0308"]),
  assertion("Hangul", "\u1111\u1171\u11B6", 0, ["퓛"]), assertion("angstrom compatibility", "Å", 0, ["Å"]),
  assertion("angstrom decomposed", "Å", 0, ["A\u030A"]), assertion("reordered horn and dot", "x\u031B\u0323", 0, ["x\u0323\u031B"]),
  assertion("Vietnamese precomposed 1", "ự", 0, ["ụ\u031B"]), assertion("Vietnamese decomposed", "ự", 0, ["u\u031B\u0323"]),
  assertion("Vietnamese precomposed 2", "ự", 0, ["ư\u0323"]), assertion("Vietnamese reordered", "ự", 0, ["u\u0323\u031B"]),
  assertion("cedilla", "Ç", 0, ["C\u0327"]), assertion("q reordered", "q\u0307\u0323", 0, ["q\u0323\u0307"]),
  assertion("Hangul syllable", "가", 0, ["\u1100\u1161"]), assertion("ohm", "Ω", 0, ["Ω"]),
  assertion("angstrom", "Å", 0, ["A\u030A"]), assertion("circumflex", "ô", 0, ["o\u0302"]),
  assertion("s with marks", "ṩ", 0, ["s\u0323\u0307"]), assertion("d composed plus dot", "ḋ\u0323", 0, ["d\u0323\u0307"]),
  assertion("d two precompositions", "ḋ\u0323", 0, ["ḍ\u0307"]),
])

add("test/built-ins/String/fromCharCode/S15.5.3.2_A2.js", "fromCharCode", [{ label: "no arguments", expected: "" }], true)
add("test/built-ins/String/fromCharCode/S15.5.3.2_A3_T1.js", "fromCharCode", [{ label: "ABBA", args: [65, 66, 66, 65], expected: "ABBA" }], true)
add("test/built-ins/String/fromCharCode/S9.7_A1.js", "fromCharCode", [
  { label: "NaN", args: [NaN], expected: 0 }, { label: "zero", args: [0], expected: 0 }, { label: "negative zero", args: [-0], expected: 0 },
  { label: "positive infinity", args: [Infinity], expected: 0 }, { label: "negative infinity", args: [-Infinity], expected: 0 },
], true)
add("test/built-ins/String/fromCharCode/S9.7_A2.1.js", "fromCharCode", [
  [0, 0], [1, 1], [-1, 65535], [65535, 65535], [65534, 65534], [65536, 0], [4294967295, 65535], [4294967294, 65534], [4294967296, 0],
].map(([input, expected]) => ({ label: String(input), args: [input!], expected })), true)
add("test/built-ins/String/fromCharCode/S9.7_A2.2.js", "fromCharCode", [
  [-32767, 32769], [-32768, 32768], [-32769, 32767], [-65535, 1], [-65536, 0], [-65537, 65535], [65535, 65535], [65536, 0], [65537, 1], [131071, 65535], [131072, 0], [131073, 1],
].map(([input, expected]) => ({ label: String(input), args: [input!], expected })), true)
add("test/built-ins/String/fromCharCode/S9.7_A3.2_T1.js", "fromCharCode", [
  { label: "positive fraction", args: [1.2345], expected: 1 }, { label: "negative fraction", args: [-5.4321], expected: 65531 },
], true)

add("test/built-ins/String/fromCodePoint/arguments-is-empty.js", "fromCodePoint", [{ label: "no arguments", expected: "" }], true)
add("test/built-ins/String/fromCodePoint/return-string-value.js", "fromCodePoint", [
  { label: "NUL", args: [0], expected: "\x00" }, { label: "asterisk", args: [42], expected: "*" },
  { label: "AZ", args: [65, 90], expected: "AZ" }, { label: "Cyrillic", args: [0x404], expected: "\u0404" },
  { label: "hex supplementary", args: [0x2f804], expected: "\uD87E\uDC04" }, { label: "decimal supplementary", args: [194564], expected: "\uD87E\uDC04" },
  { label: "mixed supplementary", args: [0x1d306, 0x61, 0x1d307], expected: "\uD834\uDF06a\uD834\uDF07" },
  { label: "maximum code point", args: [1114111], expected: "\uDBFF\uDFFF" },
], true)
add("test/built-ins/String/fromCodePoint/argument-is-not-integer.js", "fromCodePoint", [
  { label: "fraction", args: [3.14], outcome: "RangeError" }, { label: "fraction after valid", args: [42, 3.14], outcome: "RangeError" },
], true)
add("test/built-ins/String/fromCodePoint/number-is-out-of-range.js", "fromCodePoint", [
  { label: "negative one", args: [-1], outcome: "RangeError" }, { label: "negative after valid", args: [1, -1], outcome: "RangeError" },
  { label: "above maximum", args: [1114112], outcome: "RangeError" }, { label: "infinity", args: [Infinity], outcome: "RangeError" },
], true)

describe("Test262-adapted core String behavior", () => {
  for (const vector of vectors) {
    test(vector.path, async () => {
      const results = vector.assertions.map((item) => {
        const args = (item.args ?? []).map(literal).join(", ")
        const expression = vector.static
          ? `String.${vector.method}(${args})`
          : `${JSON.stringify(item.input)}.${vector.method}(${args})`
        const observed = vector.static && vector.method === "fromCharCode" && typeof item.expected === "number"
          ? `${expression}.charCodeAt(0)`
          : expression
        const checked = item.outcome === "undefined"
          ? `${observed} === undefined`
          : item.outcome === "length"
            ? `${observed}.length`
            : item.outcome === "RangeError"
              ? `(() => { try { ${observed}; return false } catch (error) { return error instanceof RangeError } })()`
              : observed
        return `{ label: ${JSON.stringify(item.label)}, value: ${checked} }`
      })
      const expected = vector.assertions.map((item) => ({
        label: item.label,
        value: item.outcome === undefined || item.outcome === "length" ? item.expected! : true,
      }))
      expect(await value(`return [${results.join(",")}]`)).toEqual(expected)
    })
  }
})
