/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/language/statements/labeled/continue.js
 * - test/language/statements/break/S12.8_A4_T1.js
 * - test/language/statements/continue/simple-and-labeled.js
 * - test/language/statements/continue/labeled-continue.js
 * - test/language/statements/continue/nested-let-bound-for-loops-labeled-continue.js
 *
 * Copyright (C) 2009 the Sputnik authors. All rights reserved.
 * Copyright (C) 2014, 2016 the V8 project authors. All rights reserved.
 * Test262 portions are governed by the BSD license in LICENSE.test262.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../src/index.js"

const execute = (code: string) => Effect.runPromise(CodeMode.execute({ code, tools: {} }))

const value = async (code: string) => {
  const result = await execute(code)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

describe("Test262 labeled break adaptations", () => {
  test("break exits the matching labeled statement", async () => {
    expect(
      await value(`
        const visited = []
        target: {
          visited.push(1)
          break target
          visited.push(2)
        }
        visited.push(3)
        return visited
      `),
    ).toEqual([1, 3])
  })

  test("break crosses nested loops and switches without being consumed early", async () => {
    expect(
      await value(`
        const visited = []
        outer: for (const item of [1, 2, 3]) {
          switch (item) {
            case 2:
              break outer
            default:
              visited.push(item)
          }
        }
        return visited
      `),
    ).toEqual([1])
  })

  test("break targets every supported loop form", async () => {
    expect(
      await value(`
        const counts = { while: 0, doWhile: 0, for: 0, forOf: 0, forIn: 0 }
        whileLabel: while (true) {
          counts.while++
          break whileLabel
        }
        doLabel: do {
          counts.doWhile++
          break doLabel
        } while (true)
        forLabel: for (;;) {
          counts.for++
          break forLabel
        }
        forOfLabel: for (const item of [1, 2]) {
          counts.forOf++
          break forOfLabel
        }
        forInLabel: for (const key in { a: 1, b: 2 }) {
          counts.forIn++
          break forInLabel
        }
        return counts
      `),
    ).toEqual({ while: 1, doWhile: 1, for: 1, forOf: 1, forIn: 1 })
  })

  test("nested labels consume only their matching break", async () => {
    expect(
      await value(`
        const visited = []
        outer: {
          inner: {
            visited.push(1)
            break outer
          }
          visited.push(2)
        }
        visited.push(3)
        return visited
      `),
    ).toEqual([1, 3])
  })
})

describe("Test262 labeled continue adaptations", () => {
  test("continue targets its labeled for loop", async () => {
    expect(
      await value(`
        let count = 0
        label: for (let index = 0; index < 10; index++) {
          count++
          continue label
        }
        return count
      `),
    ).toBe(10)
  })

  test("continue escapes an inner loop for the targeted outer loop", async () => {
    expect(
      await value(`
        let count = 0
        outer: for (let x = 0; x < 10; x++) {
          let y = 0
          while (true) {
            y++
            count++
            if (y === 1) continue outer
            throw new Error("inner loop consumed the outer continue")
          }
        }
        return count
      `),
    ).toBe(10)
  })

  test("multiple labels can target the same iteration statement", async () => {
    expect(
      await value(`
        const visited = []
        outer: inner: for (const item of [1, 2, 3]) {
          visited.push(item)
          continue outer
        }
        return visited
      `),
    ).toEqual([1, 2, 3])
  })

  test("labeled continue works for every supported loop form", async () => {
    expect(
      await value(`
        const counts = { while: 0, doWhile: 0, forOf: 0, forIn: 0 }
        let index = 0
        whileLabel: while (index++ < 2) {
          counts.while++
          continue whileLabel
        }

        index = 0
        doLabel: do {
          counts.doWhile++
          if (index++ < 1) continue doLabel
        } while (index < 2)

        forOfLabel: for (const item of [1, 2]) {
          counts.forOf += item
          continue forOfLabel
        }

        forInLabel: for (const key in { a: 1, b: 2 }) {
          counts.forIn++
          continue forInLabel
        }
        return counts
      `),
    ).toEqual({ while: 2, doWhile: 2, forOf: 3, forIn: 2 })
  })

  test("labeled continues preserve per-iteration lexical bindings", async () => {
    expect(
      await value(`
        const classic = []
        classicLabel: for (let index = 0; index < 3; index++) {
          classic.push(() => index)
          continue classicLabel
        }

        const nested = []
        nestedLabel: for (let outer = 0; outer < 3; outer++) {
          for (let inner = 0; inner < 2; inner++) {
            nested.push(() => outer)
            continue nestedLabel
          }
        }

        const forOf = []
        forOfLabel: for (const item of [1, 2, 3]) {
          forOf.push(() => item)
          continue forOfLabel
        }
        return [classic.map((read) => read()), nested.map((read) => read()), forOf.map((read) => read())]
      `),
    ).toEqual([
      [0, 1, 2],
      [0, 1, 2],
      [1, 2, 3],
    ])
  })

  test("finally completions override labeled loop control", async () => {
    expect(
      await value(`
        const visited = []
        breakWins: for (const item of [1, 2, 3]) {
          try {
            continue breakWins
          } finally {
            visited.push(item)
            break breakWins
          }
        }

        continueWins: for (const item of [4, 5, 6]) {
          try {
            break continueWins
          } finally {
            visited.push(item)
            continue continueWins
          }
        }
        return visited
      `),
    ).toEqual([1, 4, 5, 6])
  })

  test("a label on a non-iteration statement is not a continue target", async () => {
    const result = await execute(`
      do {
        target: {
          continue target
        }
      } while (false)
    `)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("ParseError")
  })
})
