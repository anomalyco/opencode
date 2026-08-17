/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/built-ins/Object/groupBy/evenOdd.js
 * - test/built-ins/Object/groupBy/groupLength.js
 * - test/built-ins/Object/groupBy/callback-arg.js
 * - test/built-ins/Object/groupBy/string.js
 * - test/built-ins/Object/groupBy/emptyList.js
 * - test/built-ins/Object/groupBy/toPropertyKey.js
 * - test/built-ins/Object/groupBy/invalid-property-key.js
 * - test/built-ins/Object/groupBy/invalid-iterable.js
 * - test/built-ins/Object/groupBy/invalid-callback.js
 * - test/built-ins/Object/groupBy/callback-throws.js
 * - test/built-ins/Object/groupBy/null-prototype.js
 * - test/built-ins/Map/groupBy/evenOdd.js
 * - test/built-ins/Map/groupBy/groupLength.js
 * - test/built-ins/Map/groupBy/callback-arg.js
 * - test/built-ins/Map/groupBy/string.js
 * - test/built-ins/Map/groupBy/emptyList.js
 * - test/built-ins/Map/groupBy/toPropertyKey.js
 * - test/built-ins/Map/groupBy/negativeZero.js
 * - test/built-ins/Map/groupBy/invalid-iterable.js
 * - test/built-ins/Map/groupBy/invalid-callback.js
 * - test/built-ins/Map/groupBy/callback-throws.js
 * - test/built-ins/Map/groupBy/map-instance.js
 *
 * Copyright (c) 2023 Ecma International.  All rights reserved.
 * Test262 portions are governed by the BSD license in LICENSE.test262.
 * Invalid-iterable cases use a plain object, equivalent to the upstream object's absent
 * Symbol.iterator; CodeMode does not support symbol-keyed properties.
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

describe("Object.groupBy Test262 parity", () => {
  test("groups values by coerced property keys", async () => {
    expect(
      await value(`
        const values = [1, 2, 3]
        const grouped = Object.groupBy(values, (value) => value % 2 === 0 ? "even" : "odd")
        const stringable = { toString: () => 1 }
        const coerced = Object.groupBy([1, "1", stringable], (value) => value)
        const lengths = Object.groupBy(["hello", "test", "world"], (value) => value.length)
        return [
          Object.keys(grouped), grouped.even, grouped.odd, grouped.toString === undefined,
          Object.keys(coerced), coerced[1].length,
          Object.keys(lengths), lengths[5], lengths[4],
        ]
      `),
    ).toEqual([["odd", "even"], [2], [1, 3], true, ["1"], 3, ["4", "5"], ["hello", "world"], ["test"]])
  })

  test("passes each value and index to the callback", async () => {
    expect(
      await value(`
        const values = [-0, 0, 1, 2, 3]
        const seen = []
        Object.groupBy(values, (value, index, ...extra) => {
          seen.push([value === values[index], index, extra.length])
          return null
        })
        return seen
      `),
    ).toEqual([
      [true, 0, 0],
      [true, 1, 0],
      [true, 2, 0],
      [true, 3, 0],
      [true, 4, 0],
    ])
  })

  test("supports strings and empty collections", async () => {
    expect(
      await value(`
        const grouped = Object.groupBy("🥰💩🙏😈", (char) => char < "🙏" ? "before" : "after")
        const empty = Object.groupBy([], () => { throw new Error("not called") })
        return [Object.keys(grouped), grouped.before, grouped.after, Object.keys(empty)]
      `),
    ).toEqual([["after", "before"], ["💩", "😈"], ["🥰", "🙏"], []])
  })

  test("rejects invalid inputs and propagates callback and key-coercion failures", async () => {
    expect(
      await value(`
        const messages = []
        try { Object.groupBy({}, () => { throw new Error("not called") }) } catch (error) { messages.push(error.name) }
        for (const callback of [null, undefined, {}]) {
          try { Object.groupBy([], callback) } catch (error) { messages.push(error.name) }
        }
        try { Object.groupBy([1], () => { throw new Error("callback") }) } catch (error) { messages.push(error.message) }
        try {
          Object.groupBy([1], () => ({
            toString: () => { throw new Error("property key") },
          }))
        } catch (error) { messages.push(error.message) }
        return messages
      `),
    ).toEqual(["TypeError", "TypeError", "TypeError", "TypeError", "callback", "property key"])
  })
})

describe("Map.groupBy Test262 parity", () => {
  test("returns a Map with identity-preserving groups", async () => {
    expect(
      await value(`
        const stringable = { toString: () => 1 }
        const grouped = Map.groupBy([1, "1", stringable], (value) => value)
        const parity = Map.groupBy([1, 2, 3], (value) => value % 2 === 0 ? "even" : "odd")
        const lengths = Map.groupBy(["hello", "test", "world"], (value) => value.length)
        return [
          grouped instanceof Map,
          grouped.size,
          grouped.get(1),
          grouped.get("1"),
          grouped.has(stringable),
          grouped.keys().length,
          parity.get("even"),
          parity.get("odd"),
          lengths.keys(),
          lengths.get(5),
          lengths.get(4),
        ]
      `),
    ).toEqual([true, 3, [1], ["1"], true, 3, [2], [1, 3], [5, 4], ["hello", "world"], ["test"]])
  })

  test("normalizes negative zero and passes each value and index", async () => {
    expect(
      await value(`
        const values = [-0, 0, 1, 2, 3]
        const seen = []
        const grouped = Map.groupBy(values, (value, index, ...extra) => {
          seen.push([value === values[index], index, extra.length])
          return value
        })
        return [grouped.size, grouped.get(0), seen]
      `),
    ).toEqual([
      4,
      [-0, 0],
      [
        [true, 0, 0],
        [true, 1, 0],
        [true, 2, 0],
        [true, 3, 0],
        [true, 4, 0],
      ],
    ])
  })

  test("supports strings and empty collections", async () => {
    expect(
      await value(`
        const grouped = Map.groupBy("🥰💩🙏😈", (char) => char < "🙏" ? "before" : "after")
        const empty = Map.groupBy([], () => { throw new Error("not called") })
        return [grouped.keys(), grouped.get("before"), grouped.get("after"), empty.size]
      `),
    ).toEqual([["after", "before"], ["💩", "😈"], ["🥰", "🙏"], 0])
  })

  test("rejects invalid inputs and propagates callback failures", async () => {
    expect(
      await value(`
        const results = []
        try { Map.groupBy({}, () => { throw new Error("not called") }) } catch (error) { results.push(error.name) }
        for (const callback of [null, undefined, {}]) {
          try { Map.groupBy([], callback) } catch (error) { results.push(error.name) }
        }
        try { Map.groupBy([1], () => { throw new Error("callback") }) }
        catch (error) { results.push(error.message) }
        return results
      `),
    ).toEqual(["TypeError", "TypeError", "TypeError", "TypeError", "callback"])
  })
})
