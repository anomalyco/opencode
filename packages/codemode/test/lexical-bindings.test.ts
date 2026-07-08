/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/language/statements/let/block-local-use-before-initialization-in-declaration-statement.js
 * - test/language/statements/let/block-local-use-before-initialization-in-prior-statement.js
 * - test/language/statements/let/block-local-closure-get-before-initialization.js
 * - test/language/statements/block/scope-lex-close.js
 * - test/language/statements/for-of/head-let-fresh-binding-per-iteration.js
 *
 * Copyright (C) 2011 the V8 project authors. All rights reserved.
 * Copyright (C) 2016 the V8 project authors. All rights reserved.
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

describe("lexical let and const bindings", () => {
  test("an inner let is in TDZ during its own initializer", async () => {
    // test/language/statements/let/block-local-use-before-initialization-in-declaration-statement.js
    expect(
      await value(`
        let value = "outer"
        try {
          { let value = value }
        } catch (error) {
          return error.name
        }
        return "no error"
      `),
    ).toBe("ReferenceError")
  })

  test("a later lexical declaration shadows an outer binding in prior statements", async () => {
    // test/language/statements/let/block-local-use-before-initialization-in-prior-statement.js
    expect(
      await value(`
        const value = "outer"
        try {
          {
            value
            const value = "inner"
          }
        } catch (error) {
          return error.name
        }
        return "no error"
      `),
    ).toBe("ReferenceError")
  })

  test("a closure observes TDZ and then the initialized binding", async () => {
    // test/language/statements/let/block-local-closure-get-before-initialization.js
    expect(
      await value(`
        const value = "outer"
        {
          const read = () => value
          let before
          try { read() } catch (error) { before = error.name }
          let value = "inner"
          return [before, read()]
        }
      `),
    ).toEqual(["ReferenceError", "inner"])
  })

  test("a block binding does not leak while its closure retains it", async () => {
    // test/language/statements/block/scope-lex-close.js
    expect(
      await value(`
        const value = "outside"
        let read
        {
          const value = "inside"
          read = () => value
        }
        return [value, read()]
      `),
    ).toEqual(["outside", "inside"])
  })

  test("for-of closures capture a fresh let binding per iteration", async () => {
    // test/language/statements/for-of/head-let-fresh-binding-per-iteration.js
    expect(
      await value(`
        const readers = []
        for (let item of [{ label: "first" }, { label: "second" }]) {
          readers.push(() => item.label)
          item = { label: item.label + "!" }
        }
        return readers.map(read => read())
      `),
    ).toEqual(["first!", "second!"])
  })
})
