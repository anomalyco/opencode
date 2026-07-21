/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/language/statements/for-await-of/ticks-with-sync-iter-resolved-promise-and-constructor-lookup.js
 * - test/language/statements/for-await-of/async-func-dstr-let-ary-ptrn-elem-id-iter-val.js
 * - test/language/statements/for-await-of/async-func-decl-dstr-array-rest-after-element.js
 *
 * Copyright (C) 2019 André Bargull. All rights reserved.
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

describe("Test262 for-await-of adaptations", () => {
  test("awaits promise and plain values from a synchronous array", async () => {
    expect(
      await value(`
        const values = []
        for await (const item of [Promise.resolve(1), 2, new Promise((resolve) => resolve(3))]) {
          values.push(item)
        }
        return values
      `),
    ).toEqual([1, 2, 3])
  })

  test("defers the body even for an already-resolved or plain value", async () => {
    expect(
      await value(`
        const events = []
        const before = Promise.resolve().then(() => events.push("before"))
        for await (const item of [Promise.resolve(1), 2]) events.push("body " + item)
        await before
        return events
      `),
    ).toEqual(["before", "body 1", "body 2"])
  })

  test("an awaited rejection exits through normal try/catch", async () => {
    const result = await execute(`
        const values = []
        try {
          for await (const item of [Promise.resolve(1), Promise.reject("stop"), Promise.resolve(3)]) {
            values.push(item)
          }
        } catch (error) {
          return [values, error]
        }
        return "missed"
      `)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual([[1], "stop"])
    expect(result.warnings ?? []).toEqual([])
  })

  test("destructures after resolving each yielded value", async () => {
    expect(
      await value(`
        const values = []
        for await (const [first, ...rest] of [Promise.resolve([1, 2, 3])]) {
          values.push(first, rest)
        }
        return values
      `),
    ).toEqual([1, [2, 3]])
  })

  test("supports assignment targets", async () => {
    expect(
      await value(`
        let first
        let rest
        for await ([first, ...rest] of [Promise.resolve([1, 2, 3])]) {}
        return [first, rest]
      `),
    ).toEqual([1, [2, 3]])
  })

  test("preserves fresh lexical bindings per iteration", async () => {
    expect(
      await value(`
        const reads = []
        for await (const item of [Promise.resolve(1), Promise.resolve(2), Promise.resolve(3)]) {
          reads.push(() => item)
        }
        return reads.map((read) => read())
      `),
    ).toEqual([1, 2, 3])
  })

  test("supports every existing collection iterable", async () => {
    expect(
      await value(`
        const string = []
        for await (const item of "ab") string.push(item)

        const set = []
        for await (const item of new Set([Promise.resolve(1), 2])) set.push(item)

        const map = []
        for await (const [key, item] of new Map([["a", 1], ["b", 2]])) map.push(key, item)

        const params = []
        for await (const [key, item] of new URLSearchParams("a=1&b=2")) params.push(key, item)
        return { string, set, map, params }
      `),
    ).toEqual({ string: ["a", "b"], set: [1, 2], map: ["a", 1, "b", 2], params: ["a", "1", "b", "2"] })
  })

  test("preserves labeled break and continue behavior", async () => {
    expect(
      await value(`
        const values = []
        outer: for await (const item of [1, 2, 3, 4]) {
          if (item === 2) continue outer
          if (item === 4) break outer
          values.push(item)
        }
        return values
      `),
    ).toEqual([1, 3])
  })

  test("keeps custom iterator objects outside the supported subset", async () => {
    const result = await execute(`for await (const item of { values: [1, 2] }) {}`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain("for await...of requires an array, string, Map, Set, or URLSearchParams")
  })
})
