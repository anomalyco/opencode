/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/built-ins/String/prototype/split/separator-regexp.js
 * - test/built-ins/String/prototype/split/arguments-are-regexp-s-and-3-and-instance-is-string-a-b-c-de-f.js
 * - test/built-ins/String/prototype/split/argument-is-regexp-s-and-instance-is-string-a-b-c-de-f.js
 * - test/built-ins/String/prototype/split/argument-is-regexp-d-and-instance-is-string-dfe23iu-34-65.js
 * - test/built-ins/String/prototype/split/argument-is-regexp-reg-exp-d-and-instance-is-string-dfe23iu-34-65.js
 * - test/built-ins/String/prototype/split/argument-is-regexp-a-z-and-instance-is-string-abc.js
 * - test/built-ins/String/prototype/split/argument-is-reg-exp-a-z-and-instance-is-string-abc.js
 * - test/built-ins/String/prototype/split/arguments-are-regexp-l-and-undefined-and-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/arguments-are-regexp-l-and-0-and-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/arguments-are-regexp-l-and-1-and-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/arguments-are-regexp-l-and-2-and-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/arguments-are-regexp-l-and-3-and-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/arguments-are-regexp-l-and-4-and-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/argument-is-regexp-l-and-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/argument-is-new-reg-exp-and-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/arguments-are-new-reg-exp-and-0-and-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/arguments-are-new-reg-exp-and-1-and-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/arguments-are-new-reg-exp-and-2-and-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/arguments-are-new-reg-exp-and-3-and-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/arguments-are-new-reg-exp-and-4-and-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/arguments-are-new-reg-exp-and-undefined-and-instance-is-string-hello.js
 * - test/built-ins/String/prototype/split/call-split-2-instance-is-string-one-two-three-four-five.js
 * - test/built-ins/String/prototype/split/separator-regexp-comma-instance-is-string-one-1-two-2-four-4.js
 * - test/built-ins/String/prototype/split/argument-is-regexp-x-and-instance-is-string-a-b-c-de-f.js
 * - test/built-ins/String/prototype/replace/regexp-capture-by-index.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A1_T17.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A2_T1.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A2_T2.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A2_T3.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A2_T4.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A2_T5.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A2_T6.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A2_T7.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A2_T8.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A2_T9.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A2_T10.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A3_T1.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A3_T2.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A3_T3.js
 * - test/built-ins/String/prototype/replace/S15.5.4.11_A5_T1.js
 * - test/built-ins/String/prototype/replaceAll/searchValue-replacer-RegExp-call.js
 * - test/built-ins/String/prototype/replaceAll/searchValue-empty-string.js
 * - test/built-ins/String/prototype/replaceAll/searchValue-empty-string-this-empty-string.js
 * - test/built-ins/String/prototype/replaceAll/replaceValue-value-replaces-string.js
 * - test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024.js
 * - test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024-0x0024.js
 * - test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024-0x0026.js
 * - test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024-0x0060.js
 * - test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024-0x0027.js
 * - test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024N.js
 * - test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024NN.js
 * - test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024-0x003C.js
 * - test/built-ins/String/prototype/match/S15.5.4.10_A1_T14.js
 * - test/built-ins/String/prototype/match/S15.5.4.10_A2_T2.js
 * - test/built-ins/String/prototype/match/S15.5.4.10_A2_T3.js
 * - test/built-ins/String/prototype/match/S15.5.4.10_A2_T4.js
 * - test/built-ins/String/prototype/match/S15.5.4.10_A2_T5.js
 * - test/built-ins/String/prototype/match/S15.5.4.10_A2_T6.js
 * - test/built-ins/String/prototype/match/S15.5.4.10_A2_T7.js
 * - test/built-ins/String/prototype/match/S15.5.4.10_A2_T8.js
 * - test/built-ins/String/prototype/match/S15.5.4.10_A2_T12.js
 * - test/built-ins/String/prototype/matchAll/regexp-prototype-matchAll-v-u-flag.js
 * - test/built-ins/String/prototype/search/S15.5.4.12_A1_T14.js
 * - test/built-ins/String/prototype/search/S15.5.4.12_A2_T1.js
 * - test/built-ins/String/prototype/search/S15.5.4.12_A2_T2.js
 * - test/built-ins/String/prototype/search/S15.5.4.12_A2_T3.js
 * - test/built-ins/String/prototype/search/S15.5.4.12_A2_T4.js
 * - test/built-ins/String/prototype/search/S15.5.4.12_A2_T5.js
 * - test/built-ins/String/prototype/search/S15.5.4.12_A2_T6.js
 * - test/built-ins/String/prototype/search/S15.5.4.12_A2_T7.js
 * - test/built-ins/String/prototype/search/S15.5.4.12_A3_T1.js
 * - test/built-ins/String/prototype/search/S15.5.4.12_A3_T2.js
 *
 * Copyright 2009 the Sputnik authors.  All rights reserved.
 * Copyright (C) 2019 Leo Balter. All rights reserved.
 * Copyright (C) 2020 Rick Waldron. All rights reserved.
 * Copyright (C) 2023 Richard Gibson. All rights reserved.
 * Copyright (C) 2024 Tan Meng. All rights reserved.
 * Test262 portions are governed by the BSD license in LICENSE.test262.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../src/index.js"

type Vector = {
  readonly path: string
  readonly code: string
  readonly expected: CodeMode.DataValue
}

const value = async (code: string) => {
  const result = await Effect.runPromise(CodeMode.execute({ code, tools: {} }))
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

const run = (name: string, vectors: ReadonlyArray<Vector>) => {
  describe(name, () => {
    for (const vector of vectors) {
      test(vector.path, async () => {
        expect(await value(vector.code)).toEqual(vector.expected)
      })
    }
  })
}

run("Test262-adapted regexp split behavior", [
  {
    path: "test/built-ins/String/prototype/split/separator-regexp.js",
    code: `
      return [
        "x".split(/^/), "x".split(/$/), "x".split(/.?/), "x".split(/.*/), "x".split(/.+/),
        "x".split(/.*?/), "x".split(/.{1}/), "x".split(/.{1,}/), "x".split(/.{1,2}/),
        "x".split(/()/), "x".split(/./), "x".split(/(?:)/), "x".split(/(...)/),
        "x".split(/(|)/), "x".split(/[]/), "x".split(/[^]/), "x".split(/[.-.]/),
        "x".split(/\\0/), "x".split(/\\b/), "x".split(/\\B/), "x".split(/\\d/),
        "x".split(/\\D/), "x".split(/\\n/), "x".split(/\\r/), "x".split(/\\s/),
        "x".split(/\\S/), "x".split(/\\v/), "x".split(/\\w/), "x".split(/\\W/),
      ]
    `,
    expected: [
      ["x"], ["x"], ["", ""], ["", ""], ["", ""], ["x"], ["", ""], ["", ""], ["", ""],
      ["x"], ["", ""], ["x"], ["x"], ["x"], ["x"], ["", ""], ["x"], ["x"], ["x"],
      ["x"], ["x"], ["", ""], ["x"], ["x"], ["x"], ["", ""], ["x"], ["", ""], ["x"],
    ],
  },
  {
    path: "test/built-ins/String/prototype/split/arguments-are-regexp-s-and-3-and-instance-is-string-a-b-c-de-f.js",
    code: `return "a b c de f".split(/\\s/, 3)`,
    expected: ["a", "b", "c"],
  },
  {
    path: "test/built-ins/String/prototype/split/argument-is-regexp-s-and-instance-is-string-a-b-c-de-f.js",
    code: `return "a b c de f".split(/\\s/)`,
    expected: ["a", "b", "c", "de", "f"],
  },
  {
    path: "test/built-ins/String/prototype/split/argument-is-regexp-d-and-instance-is-string-dfe23iu-34-65.js",
    code: `return "dfe23iu 34 =+65--".split(/\\d+/)`,
    expected: ["dfe", "iu ", " =+", "--"],
  },
  {
    path: "test/built-ins/String/prototype/split/argument-is-regexp-reg-exp-d-and-instance-is-string-dfe23iu-34-65.js",
    code: `return "dfe23iu 34 =+65--".split(new RegExp("\\\\d+"))`,
    expected: ["dfe", "iu ", " =+", "--"],
  },
  {
    path: "test/built-ins/String/prototype/split/argument-is-regexp-a-z-and-instance-is-string-abc.js",
    code: `return "abc".split(/[a-z]/)`,
    expected: ["", "", "", ""],
  },
  {
    path: "test/built-ins/String/prototype/split/argument-is-reg-exp-a-z-and-instance-is-string-abc.js",
    code: `return "abc".split(new RegExp("[a-z]"))`,
    expected: ["", "", "", ""],
  },
  {
    path: "test/built-ins/String/prototype/split/arguments-are-regexp-l-and-undefined-and-instance-is-string-hello.js",
    code: `return "hello".split(/l/, undefined)`,
    expected: ["he", "", "o"],
  },
  {
    path: "test/built-ins/String/prototype/split/arguments-are-regexp-l-and-0-and-instance-is-string-hello.js",
    code: `return "hello".split(/l/, 0)`,
    expected: [],
  },
  {
    path: "test/built-ins/String/prototype/split/arguments-are-regexp-l-and-1-and-instance-is-string-hello.js",
    code: `return "hello".split(/l/, 1)`,
    expected: ["he"],
  },
  {
    path: "test/built-ins/String/prototype/split/arguments-are-regexp-l-and-2-and-instance-is-string-hello.js",
    code: `return "hello".split(/l/, 2)`,
    expected: ["he", ""],
  },
  {
    path: "test/built-ins/String/prototype/split/arguments-are-regexp-l-and-3-and-instance-is-string-hello.js",
    code: `return "hello".split(/l/, 3)`,
    expected: ["he", "", "o"],
  },
  {
    path: "test/built-ins/String/prototype/split/arguments-are-regexp-l-and-4-and-instance-is-string-hello.js",
    code: `return "hello".split(/l/, 4)`,
    expected: ["he", "", "o"],
  },
  {
    path: "test/built-ins/String/prototype/split/argument-is-regexp-l-and-instance-is-string-hello.js",
    code: `return "hello".split(/l/)`,
    expected: ["he", "", "o"],
  },
  {
    path: "test/built-ins/String/prototype/split/argument-is-new-reg-exp-and-instance-is-string-hello.js",
    code: `return "hello".split(new RegExp())`,
    expected: ["h", "e", "l", "l", "o"],
  },
  {
    path: "test/built-ins/String/prototype/split/arguments-are-new-reg-exp-and-0-and-instance-is-string-hello.js",
    code: `return "hello".split(new RegExp(), 0)`,
    expected: [],
  },
  {
    path: "test/built-ins/String/prototype/split/arguments-are-new-reg-exp-and-1-and-instance-is-string-hello.js",
    code: `return "hello".split(new RegExp(), 1)`,
    expected: ["h"],
  },
  {
    path: "test/built-ins/String/prototype/split/arguments-are-new-reg-exp-and-2-and-instance-is-string-hello.js",
    code: `return "hello".split(new RegExp(), 2)`,
    expected: ["h", "e"],
  },
  {
    path: "test/built-ins/String/prototype/split/arguments-are-new-reg-exp-and-3-and-instance-is-string-hello.js",
    code: `return "hello".split(new RegExp(), 3)`,
    expected: ["h", "e", "l"],
  },
  {
    path: "test/built-ins/String/prototype/split/arguments-are-new-reg-exp-and-4-and-instance-is-string-hello.js",
    code: `return "hello".split(new RegExp(), 4)`,
    expected: ["h", "e", "l", "l"],
  },
  {
    path: "test/built-ins/String/prototype/split/arguments-are-new-reg-exp-and-undefined-and-instance-is-string-hello.js",
    code: `return "hello".split(new RegExp(), undefined)`,
    expected: ["h", "e", "l", "l", "o"],
  },
  {
    path: "test/built-ins/String/prototype/split/call-split-2-instance-is-string-one-two-three-four-five.js",
    code: `return "one two three four five".split(/ /, 2)`,
    expected: ["one", "two"],
  },
  {
    path: "test/built-ins/String/prototype/split/separator-regexp-comma-instance-is-string-one-1-two-2-four-4.js",
    code: `return "one-1,two-2,four-4".split(/,/)`,
    expected: ["one-1", "two-2", "four-4"],
  },
  {
    path: "test/built-ins/String/prototype/split/argument-is-regexp-x-and-instance-is-string-a-b-c-de-f.js",
    code: `return "a b c de f".split(/X/)`,
    expected: ["a b c de f"],
  },
])

run("Test262-adapted replace behavior", [
  {
    path: "test/built-ins/String/prototype/replace/regexp-capture-by-index.js",
    code: `
      const str = "foo-x-bar"
      const patterns = ["x", /x/, /(x)/, /(x)($^)?/, /((((((((((x))))))))))/]
      const replacements = ["|$0|", "|$00|", "|$000|", "|$1|", "|$01|", "|$010|", "|$2|", "|$02|", "|$020|", "|$10|", "|$100|", "|$20|", "|$200|"]
      return replacements.flatMap((replacement) => patterns.map((pattern) => str.replace(pattern, replacement)))
    `,
    expected: [
      "foo-|$0|-bar", "foo-|$0|-bar", "foo-|$0|-bar", "foo-|$0|-bar", "foo-|$0|-bar",
      "foo-|$00|-bar", "foo-|$00|-bar", "foo-|$00|-bar", "foo-|$00|-bar", "foo-|$00|-bar",
      "foo-|$000|-bar", "foo-|$000|-bar", "foo-|$000|-bar", "foo-|$000|-bar", "foo-|$000|-bar",
      "foo-|$1|-bar", "foo-|$1|-bar", "foo-|x|-bar", "foo-|x|-bar", "foo-|x|-bar",
      "foo-|$01|-bar", "foo-|$01|-bar", "foo-|x|-bar", "foo-|x|-bar", "foo-|x|-bar",
      "foo-|$010|-bar", "foo-|$010|-bar", "foo-|x0|-bar", "foo-|x0|-bar", "foo-|x0|-bar",
      "foo-|$2|-bar", "foo-|$2|-bar", "foo-|$2|-bar", "foo-||-bar", "foo-|x|-bar",
      "foo-|$02|-bar", "foo-|$02|-bar", "foo-|$02|-bar", "foo-||-bar", "foo-|x|-bar",
      "foo-|$020|-bar", "foo-|$020|-bar", "foo-|$020|-bar", "foo-|0|-bar", "foo-|x0|-bar",
      "foo-|$10|-bar", "foo-|$10|-bar", "foo-|x0|-bar", "foo-|x0|-bar", "foo-|x|-bar",
      "foo-|$100|-bar", "foo-|$100|-bar", "foo-|x00|-bar", "foo-|x00|-bar", "foo-|x0|-bar",
      "foo-|$20|-bar", "foo-|$20|-bar", "foo-|$20|-bar", "foo-|0|-bar", "foo-|x0|-bar",
      "foo-|$200|-bar", "foo-|$200|-bar", "foo-|$200|-bar", "foo-|00|-bar", "foo-|x00|-bar",
    ],
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A1_T17.js",
    code: `return "asdf".replace(new RegExp(undefined, "g"), "1")`,
    expected: "1a1s1d1f1",
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A2_T1.js",
    code: `return "She sells seashells by the seashore.".replace(/sh/g, "sch")`,
    expected: "She sells seaschells by the seaschore.",
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A2_T2.js",
    code: `return "She sells seashells by the seashore.".replace(/sh/g, "$$sch")`,
    expected: "She sells sea$schells by the sea$schore.",
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A2_T3.js",
    code: `return "She sells seashells by the seashore.".replace(/sh/g, "$&sch")`,
    expected: "She sells seashschells by the seashschore.",
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A2_T4.js",
    code: `return "She sells seashells by the seashore.".replace(/sh/g, "$\`sch")`,
    expected: "She sells seaShe sells seaschells by the seaShe sells seashells by the seaschore.",
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A2_T5.js",
    code: `return "She sells seashells by the seashore.".replace(/sh/g, "$'sch")`,
    expected: "She sells seaells by the seashore.schells by the seaore.schore.",
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A2_T6.js",
    code: `return "She sells seashells by the seashore.".replace(/sh/, "sch")`,
    expected: "She sells seaschells by the seashore.",
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A2_T7.js",
    code: `return "She sells seashells by the seashore.".replace(/sh/, "$$sch")`,
    expected: "She sells sea$schells by the seashore.",
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A2_T8.js",
    code: `return "She sells seashells by the seashore.".replace(/sh/, "$&sch")`,
    expected: "She sells seashschells by the seashore.",
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A2_T9.js",
    code: `return "She sells seashells by the seashore.".replace(/sh/, "$\`sch")`,
    expected: "She sells seaShe sells seaschells by the seashore.",
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A2_T10.js",
    code: `return "She sells seashells by the seashore.".replace(/sh/, "$'sch")`,
    expected: "She sells seaells by the seashore.schells by the seashore.",
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A3_T1.js",
    code: `return "uid=31".replace(/(uid=)(\\d+)/, "$1115")`,
    expected: "uid=115",
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A3_T2.js",
    code: `return "uid=31".replace(/(uid=)(\\d+)/, "$1115")`,
    expected: "uid=115",
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A3_T3.js",
    code: `return "uid=31".replace(/(uid=)(\\d+)/, "$11A15")`,
    expected: "uid=1A15",
  },
  {
    path: "test/built-ins/String/prototype/replace/S15.5.4.11_A5_T1.js",
    code: `return "aaaaaaaaaa,aaaaaaaaaaaaaaa".replace(/^(a+)\\1*,\\1+$/, "$1")`,
    expected: "aaaaa",
  },
])

run("Test262-adapted replaceAll behavior", [
  {
    path: "test/built-ins/String/prototype/replaceAll/searchValue-replacer-RegExp-call.js",
    code: `
      return [
        "abc abc abc".replaceAll(new RegExp("b", "g"), "z"),
        "abc abc abc".replaceAll(new RegExp("b", "gy"), "z"),
        "abc abc abc".replaceAll(new RegExp("b", "giy"), "z"),
        "No Uppercase!".replaceAll(new RegExp("[A-Z]", "g"), ""),
        "No Uppercase?".replaceAll(new RegExp("[A-Z]", "gy"), ""),
        "NO UPPERCASE!".replaceAll(new RegExp("[A-Z]", "gy"), ""),
        "abcabcabcabc".replaceAll(new RegExp("a(b)(ca)", "g"), "$2-$1"),
        "abcabcabcabc".replaceAll(new RegExp("(a(.))", "g"), "$1$2$3"),
        "aabacadaeafagahaiajakalamano a azaya".replaceAll(new RegExp("(((((((((((((a(.).).).).).).).).))))))", "g"), "($10)-($12)-($1)"),
        "abcba".replaceAll(new RegExp("b", "g"), "$'"),
        "abcba".replaceAll(new RegExp("b", "g"), "$\`"),
        "abcba".replaceAll(new RegExp("(?<named>b)", "g"), "($<named>)"),
        "abcba".replaceAll(new RegExp("(?<named>b)", "g"), "($<named)"),
        "abcba".replaceAll(new RegExp("(?<named>b)", "g"), "($<unnamed>)"),
        "abcabcabcabc".replaceAll(new RegExp("a(b)(ca)", "g"), "($$)"),
        "abcabcabcabc".replaceAll(new RegExp("a(b)(ca)", "g"), "($)"),
        "abcabcabcabc".replaceAll(new RegExp("a(b)(ca)", "g"), "($$$$)"),
        "abcabcabcabc".replaceAll(new RegExp("a(b)(ca)", "g"), "($$$)"),
        "abcabcabcabc".replaceAll(new RegExp("a(b)(ca)", "g"), "($$&)"),
        "abcabcabcabc".replaceAll(new RegExp("a(b)(ca)", "g"), "($$1)"),
        "abcabcabcabc".replaceAll(new RegExp("a(b)(ca)", "g"), "($$\`)"),
        "abcabcabcabc".replaceAll(new RegExp("a(b)(ca)", "g"), "($$')"),
        "abcabcabcabc".replaceAll(new RegExp("a(?<z>b)(ca)", "g"), "($$<z>)"),
        "abcabcabcabc".replaceAll(new RegExp("a(b)(ca)", "g"), "($&)"),
      ]
    `,
    expected: [
      "azc azc azc", "abc abc abc", "abc abc abc", "o ppercase!", "o Uppercase?", " UPPERCASE!",
      "ca-bbcca-bbc", "abb$3cabb$3cabb$3cabb$3c",
      "(aabaca)-(aaba)-(aabacadaea)f(agahai)-(agah)-(agahaiajak)(alaman)-(alam)-(alamano a )azaya",
      "acbacaa", "aacabca", "a(b)c(b)a", "a($<named)c($<named)a", "a()c()a", "($)bc($)bc",
      "($)bc($)bc", "($$)bc($$)bc", "($$)bc($$)bc", "($&)bc($&)bc", "($1)bc($1)bc",
      "($`)bc($`)bc", "($')bc($')bc", "($<z>)bc($<z>)bc", "(abca)bc(abca)bc",
    ],
  },
  {
    path: "test/built-ins/String/prototype/replaceAll/searchValue-empty-string.js",
    code: `return ["aab c  \\nx".replaceAll("", "_"), "a".replaceAll("", "_")]`,
    expected: ["_a_a_b_ _c_ _ _\n_x_", "_a_"],
  },
  {
    path: "test/built-ins/String/prototype/replaceAll/searchValue-empty-string-this-empty-string.js",
    code: `return "".replaceAll("", "abc")`,
    expected: "abc",
  },
  {
    path: "test/built-ins/String/prototype/replaceAll/replaceValue-value-replaces-string.js",
    code: `return ["aaab a a aac".replaceAll("aa", "z"), "aaab a a aac".replaceAll("aa", "a"), "aaab a a aac".replaceAll("a", "a"), "aaab a a aac".replaceAll("a", "z")]`,
    expected: ["zab a a zc", "aab a a ac", "aaab a a aac", "zzzb z z zzc"],
  },
  {
    path: "test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024.js",
    code: `
      const str = "Ninguém é igual a ninguém. Todo o ser humano é um estranho ímpar."
      return [str.replaceAll("ninguém", "$"), str.replaceAll("é", "$"), str.replaceAll("é", "$ -"), str.replaceAll("é", "$$$")]
    `,
    expected: [
      "Ninguém é igual a $. Todo o ser humano é um estranho ímpar.",
      "Ningu$m $ igual a ningu$m. Todo o ser humano $ um estranho ímpar.",
      "Ningu$ -m $ - igual a ningu$ -m. Todo o ser humano $ - um estranho ímpar.",
      "Ningu$$m $$ igual a ningu$$m. Todo o ser humano $$ um estranho ímpar.",
    ],
  },
  {
    path: "test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024-0x0024.js",
    code: `
      const str = "Ninguém é igual a ninguém. Todo o ser humano é um estranho ímpar."
      return [str.replaceAll("ninguém", "$$"), str.replaceAll("é", "$$"), str.replaceAll("é", "$$ -"), str.replaceAll("é", "$$&"), str.replaceAll("é", "$$$"), str.replaceAll("é", "$$$$")]
    `,
    expected: [
      "Ninguém é igual a $. Todo o ser humano é um estranho ímpar.",
      "Ningu$m $ igual a ningu$m. Todo o ser humano $ um estranho ímpar.",
      "Ningu$ -m $ - igual a ningu$ -m. Todo o ser humano $ - um estranho ímpar.",
      "Ningu$&m $& igual a ningu$&m. Todo o ser humano $& um estranho ímpar.",
      "Ningu$$m $$ igual a ningu$$m. Todo o ser humano $$ um estranho ímpar.",
      "Ningu$$m $$ igual a ningu$$m. Todo o ser humano $$ um estranho ímpar.",
    ],
  },
  {
    path: "test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024-0x0026.js",
    code: `
      const str = "Ninguém é igual a ninguém. Todo o ser humano é um estranho ímpar."
      return [str.replaceAll("ninguém", "$&"), str.replaceAll("ninguém", "($&)"), str.replaceAll("é", "($&)"), str.replaceAll("é", "($&) $&")]
    `,
    expected: [
      "Ninguém é igual a ninguém. Todo o ser humano é um estranho ímpar.",
      "Ninguém é igual a (ninguém). Todo o ser humano é um estranho ímpar.",
      "Ningu(é)m (é) igual a ningu(é)m. Todo o ser humano (é) um estranho ímpar.",
      "Ningu(é) ém (é) é igual a ningu(é) ém. Todo o ser humano (é) é um estranho ímpar.",
    ],
  },
  {
    path: "test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024-0x0060.js",
    code: `
      const str = "Ninguém é igual a ninguém. Todo o ser humano é um estranho ímpar."
      return [str.replaceAll("ninguém", "$\`"), str.replaceAll("Ninguém", "$\`"), str.replaceAll("ninguém", "($\`)"), str.replaceAll("é", "($\`)")]
    `,
    expected: [
      "Ninguém é igual a Ninguém é igual a . Todo o ser humano é um estranho ímpar.",
      " é igual a ninguém. Todo o ser humano é um estranho ímpar.",
      "Ninguém é igual a (Ninguém é igual a ). Todo o ser humano é um estranho ímpar.",
      "Ningu(Ningu)m (Ninguém ) igual a ningu(Ninguém é igual a ningu)m. Todo o ser humano (Ninguém é igual a ninguém. Todo o ser humano ) um estranho ímpar.",
    ],
  },
  {
    path: "test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024-0x0027.js",
    code: `
      const str = "Ninguém é igual a ninguém. Todo o ser humano é um estranho ímpar."
      return [str.replaceAll("ninguém", "$'"), str.replaceAll(".", "--- $'"), str.replaceAll("é", "($')")]
    `,
    expected: [
      "Ninguém é igual a . Todo o ser humano é um estranho ímpar.. Todo o ser humano é um estranho ímpar.",
      "Ninguém é igual a ninguém---  Todo o ser humano é um estranho ímpar. Todo o ser humano é um estranho ímpar--- ",
      "Ningu(m é igual a ninguém. Todo o ser humano é um estranho ímpar.)m ( igual a ninguém. Todo o ser humano é um estranho ímpar.) igual a ningu(m. Todo o ser humano é um estranho ímpar.)m. Todo o ser humano ( um estranho ímpar.) um estranho ímpar.",
    ],
  },
  {
    path: "test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024N.js",
    code: `
      const str = "ABC AAA ABC AAA"
      return ["$1", "$2", "$3", "$4", "$5", "$6", "$7", "$8", "$9"].map((replacement) => str.replaceAll("ABC", replacement))
    `,
    expected: ["$1 AAA $1 AAA", "$2 AAA $2 AAA", "$3 AAA $3 AAA", "$4 AAA $4 AAA", "$5 AAA $5 AAA", "$6 AAA $6 AAA", "$7 AAA $7 AAA", "$8 AAA $8 AAA", "$9 AAA $9 AAA"],
  },
  {
    path: "test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024NN.js",
    code: `
      const str = "aaaaaaaaaaaaaaaa aaaaaaaa aaaaaaaaaaaaaaaa"
      return [str.replaceAll("a", "$11"), str.replaceAll("a", "$29")]
    `,
    expected: [
      "$11$11$11$11$11$11$11$11$11$11$11$11$11$11$11$11 $11$11$11$11$11$11$11$11 $11$11$11$11$11$11$11$11$11$11$11$11$11$11$11$11",
      "$29$29$29$29$29$29$29$29$29$29$29$29$29$29$29$29 $29$29$29$29$29$29$29$29 $29$29$29$29$29$29$29$29$29$29$29$29$29$29$29$29",
    ],
  },
  {
    path: "test/built-ins/String/prototype/replaceAll/getSubstitution-0x0024-0x003C.js",
    code: `return "aaaaaaaaaaaaaaaa aaaaaaaa aaaaaaaaaaaaaaaa".replaceAll("a", "$<")`,
    expected: "$<$<$<$<$<$<$<$<$<$<$<$<$<$<$<$< $<$<$<$<$<$<$<$< $<$<$<$<$<$<$<$<$<$<$<$<$<$<$<$<",
  },
])

run("Test262-adapted match behavior", [
  {
    path: "test/built-ins/String/prototype/match/S15.5.4.10_A1_T14.js",
    code: `const match = "ABBABABAB77BBAA".match(new RegExp("77")); return [match[0], match.index]`,
    expected: ["77", 9],
  },
  {
    path: "test/built-ins/String/prototype/match/S15.5.4.10_A2_T2.js",
    code: `return "343443444".match(/34/g)`,
    expected: ["34", "34", "34"],
  },
  {
    path: "test/built-ins/String/prototype/match/S15.5.4.10_A2_T3.js",
    code: `return "123456abcde7890".match(/\\d{1}/g)`,
    expected: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  },
  {
    path: "test/built-ins/String/prototype/match/S15.5.4.10_A2_T4.js",
    code: `return "123456abcde7890".match(/\\d{2}/g)`,
    expected: ["12", "34", "56", "78", "90"],
  },
  {
    path: "test/built-ins/String/prototype/match/S15.5.4.10_A2_T5.js",
    code: `return "123456abcde7890".match(/\\D{2}/g)`,
    expected: ["ab", "cd"],
  },
  {
    path: "test/built-ins/String/prototype/match/S15.5.4.10_A2_T6.js",
    code: `const match = "Boston, Mass. 02134".match(/([\\d]{5})([- ]?[\\d]{4})?$/); return [match[0], match[1], match[2] === undefined, match.length, match.index]`,
    expected: ["02134", "02134", true, 3, 14],
  },
  {
    path: "test/built-ins/String/prototype/match/S15.5.4.10_A2_T7.js",
    code: `return "Boston, Mass. 02134".match(/([\\d]{5})([- ]?[\\d]{4})?$/g)`,
    expected: ["02134"],
  },
  {
    path: "test/built-ins/String/prototype/match/S15.5.4.10_A2_T8.js",
    code: `const match = "Boston, MA 02134".match(/([\\d]{5})([- ]?[\\d]{4})?$/); return [match[0], match[1], match[2] === undefined, match.length, match.index]`,
    expected: ["02134", "02134", true, 3, 11],
  },
  {
    path: "test/built-ins/String/prototype/match/S15.5.4.10_A2_T12.js",
    code: `return "Boston, MA 02134".match(/([\\d]{5})([- ]?[\\d]{4})?$/g)`,
    expected: ["02134"],
  },
])

run("Test262-adapted matchAll behavior", [
  {
    path: "test/built-ins/String/prototype/matchAll/regexp-prototype-matchAll-v-u-flag.js",
    code: `
      const text = "𠮷a𠮷b𠮷"
      const collect = (regex) => {
        const matches = text.matchAll(regex)
        return matches.map((match) => match[0]).concat(matches.map((match) => match.index))
      }
      const empty = text.matchAll(/(?:)/gu)
      const complex = "a𠮷b􏿿c".matchAll(/\\P{ASCII}/gu)
      return [
        collect(/𠮷/g),
        collect(/𠮷/gu),
        collect(/\\p{Script=Han}/gu),
        collect(/./gu),
        empty.map((match) => match[0]).concat(empty.map((match) => match.index)).length,
        complex.map((match) => match[0]),
      ]
    `,
    expected: [
      ["𠮷", "𠮷", "𠮷", 0, 3, 6],
      ["𠮷", "𠮷", "𠮷", 0, 3, 6],
      ["𠮷", "𠮷", "𠮷", 0, 3, 6],
      ["𠮷", "a", "𠮷", "b", "𠮷", 0, 2, 3, 5, 6],
      12,
      ["𠮷", "􏿿"],
    ],
  },
])

run("Test262-adapted search behavior", [
  {
    path: "test/built-ins/String/prototype/search/S15.5.4.12_A1_T14.js",
    code: `return "ABBABABAB77BBAA".search(new RegExp("77"))`,
    expected: 9,
  },
  {
    path: "test/built-ins/String/prototype/search/S15.5.4.12_A2_T1.js",
    code: `return "test string".search("string")`,
    expected: 5,
  },
  {
    path: "test/built-ins/String/prototype/search/S15.5.4.12_A2_T2.js",
    code: `return "test string".search("String")`,
    expected: -1,
  },
  {
    path: "test/built-ins/String/prototype/search/S15.5.4.12_A2_T3.js",
    code: `return "test string".search(/String/i)`,
    expected: 5,
  },
  {
    path: "test/built-ins/String/prototype/search/S15.5.4.12_A2_T4.js",
    code: `return "one two three four five".search(/Four/)`,
    expected: -1,
  },
  {
    path: "test/built-ins/String/prototype/search/S15.5.4.12_A2_T5.js",
    code: `return "one two three four five".search(/four/)`,
    expected: 14,
  },
  {
    path: "test/built-ins/String/prototype/search/S15.5.4.12_A2_T6.js",
    code: `return "test string".search("notexist")`,
    expected: -1,
  },
  {
    path: "test/built-ins/String/prototype/search/S15.5.4.12_A2_T7.js",
    code: `return "test string probe".search("string pro")`,
    expected: 5,
  },
  {
    path: "test/built-ins/String/prototype/search/S15.5.4.12_A3_T1.js",
    code: `const text = "power of the power of the power of the great sword"; return [text.search(/the/), text.search(/the/g)]`,
    expected: [9, 9],
  },
  {
    path: "test/built-ins/String/prototype/search/S15.5.4.12_A3_T2.js",
    code: `const text = "power of the power of the power of the great sword"; return [text.search(/of/), text.search(/of/g)]`,
    expected: [6, 6],
  },
])
