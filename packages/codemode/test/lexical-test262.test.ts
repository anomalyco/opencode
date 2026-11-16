/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/language/statements/let/global-use-before-initialization-in-prior-statement.js
 * - test/language/statements/let/block-local-use-before-initialization-in-prior-statement.js
 * - test/language/statements/const/global-use-before-initialization-in-prior-statement.js
 * - test/language/statements/const/block-local-use-before-initialization-in-prior-statement.js
 * - test/language/statements/let/block-local-use-before-initialization-in-declaration-statement.js
 * - test/language/statements/const/block-local-use-before-initialization-in-declaration-statement.js
 * - test/language/statements/let/block-local-closure-set-before-initialization.js
 * - test/language/statements/for-of/head-let-bound-names-fordecl-tdz.js
 * - test/language/statements/for-in/head-let-bound-names-fordecl-tdz.js
 * - test/language/statements/let/syntax/let-iteration-variable-is-freshly-allocated-for-each-iteration-single-let-binding.js
 * - test/language/statements/let/syntax/let-iteration-variable-is-freshly-allocated-for-each-iteration-multi-let-binding.js
 * - test/language/statements/for-of/head-let-fresh-binding-per-iteration.js
 * - test/language/statements/for-in/head-let-fresh-binding-per-iteration.js
 * - test/language/statements/for/scope-head-lex-open.js
 * - test/language/statements/for/scope-body-lex-open.js
 * - test/language/statements/switch/scope-lex-open-case.js
 * - test/language/statements/switch/scope-lex-close-case.js
 * - test/language/statements/function/dflt-params-ref-prior.js
 * - test/language/statements/function/dflt-params-ref-later.js
 * - test/language/statements/function/dflt-params-ref-self.js
 *
 * Copyright (C) 2011, 2014, 2016 the V8 project authors. All rights reserved.
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

describe("Test262 lexical temporal dead zones", () => {
  test("program and block bindings exist before initialization", async () => {
    expect(
      await value(`
        const errors = []
        try { programLet; let programLet } catch (error) { errors.push(error.name) }
        try { programConst; const programConst = 1 } catch (error) { errors.push(error.name) }
        try { { blockLet; let blockLet } } catch (error) { errors.push(error.name) }
        try { { blockConst; const blockConst = 1 } } catch (error) { errors.push(error.name) }
        return errors
      `),
    ).toEqual(["ReferenceError", "ReferenceError", "ReferenceError", "ReferenceError"])
  })

  test("self-initialization and closure assignment observe the TDZ", async () => {
    expect(
      await value(`
        const errors = []
        try { { let item = item + 1 } } catch (error) { errors.push(error.name) }
        try { { const item = item + 1 } } catch (error) { errors.push(error.name) }
        try {
          {
            function assign() { item = 1 }
            assign()
            let item
          }
        } catch (error) { errors.push(error.name) }
        return errors
      `),
    ).toEqual(["ReferenceError", "ReferenceError", "ReferenceError"])
  })

  test("for-of and for-in bound names are in the head TDZ", async () => {
    expect(
      await value(`
        const errors = []
        try { let item = [1]; for (let item of item) {} } catch (error) { errors.push(error.name) }
        try { let item = { value: 1 }; for (let item in item) {} } catch (error) { errors.push(error.name) }
        return errors
      `),
    ).toEqual(["ReferenceError", "ReferenceError"])
  })
})

describe("Test262 lexical loop environments", () => {
  test("classic for creates fresh single and multiple bindings", async () => {
    expect(
      await value(`
        const single = []
        for (let index = 0; index < 5; ++index) single.push(() => index)

        const left = []
        const right = []
        for (let first = 0, second = 10; first < 5; ++first, ++second) {
          left.push(() => first)
          right.push(() => second)
        }
        return [
          single.map((read) => read()),
          left.map((read) => read()),
          right.map((read) => read()),
        ]
      `),
    ).toEqual([
      [0, 1, 2, 3, 4],
      [0, 1, 2, 3, 4],
      [10, 11, 12, 13, 14],
    ])
  })

  test("for-of and for-in create fresh bindings", async () => {
    expect(
      await value(`
        const values = []
        for (let item of [1, 2, 3]) values.push(() => item)

        const keys = {}
        for (let key in { first: 1, second: 2, third: 3 }) keys[key] = () => key
        return [values.map((read) => read()), keys.first(), keys.second(), keys.third()]
      `),
    ).toEqual([[1, 2, 3], "first", "second", "third"])
  })

  test("classic for separates declaration and per-iteration environments", async () => {
    expect(
      await value(`
        let before
        let testRead
        let bodyRead
        let updateRead
        let run = true
        for (
          let item = "outside", ignored = before = () => item;
          run && (item = "inside", testRead = () => item);
          updateRead = () => item
        ) bodyRead = () => item, run = false
        return [before(), testRead(), bodyRead(), updateRead()]
      `),
    ).toEqual(["outside", "inside", "inside", "inside"])
  })
})

describe("Test262 switch and parameter environments", () => {
  test("switch creates its lexical environment after the discriminant", async () => {
    expect(
      await value(`
        let item = "outside"
        let discriminantRead
        let selectorRead
        let statementRead
        switch ((discriminantRead = () => item, null)) {
          case (selectorRead = () => item, null):
            statementRead = () => item
            let item = "inside"
        }
        return [discriminantRead(), selectorRead(), statementRead()]
      `),
    ).toEqual(["outside", "inside", "inside"])
  })

  test("all switch cases share one lexical environment that closes afterward", async () => {
    expect(
      await value(`
        let item = "outside"
        let firstRead
        let secondRead
        switch (null) {
          case null:
            let item = "inside"
            firstRead = () => item
          case null:
            secondRead = () => item
        }
        return [firstRead(), secondRead(), item]
      `),
    ).toEqual(["inside", "inside", "outside"])
  })

  test("parameter defaults see prior bindings but not self or later bindings", async () => {
    expect(
      await value(`
        function prior(first, second = first, third = second) { return [first, second, third] }
        function later(first = second, second) { return first }
        function self(item = item) { return item }
        function failure(run) {
          try { return run() } catch (error) { return error.name }
        }
        return [prior(3), failure(later), failure(self)]
      `),
    ).toEqual([[3, 3, 3], "ReferenceError", "ReferenceError"])
  })
})
