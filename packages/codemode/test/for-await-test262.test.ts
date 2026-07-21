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

  test("drives a custom async iterator sequentially", async () => {
    expect(
      await value(`
        let index = 0
        const iterator = {
          [Symbol.asyncIterator]: () => iterator,
          async next() {
            index += 1
            if (index > 3) return { done: true }
            return { done: false, value: index }
          },
        }
        const values = []
        for await (const item of iterator) values.push(item)
        return values
      `),
    ).toEqual([1, 2, 3])
  })

  test("leaves async iterator values under the iterator's control", async () => {
    expect(
      await value(`
        let done = false
        const iterator = {
          [Symbol.asyncIterator]: () => iterator,
          next: async () => done ? { done: true } : (done = true, { done: false, value: Promise.resolve(1) }),
        }
        for await (const item of iterator) return [item instanceof Promise, await item]
      `),
    ).toEqual([true, 1])
  })

  test("falls back to a custom synchronous iterator", async () => {
    expect(
      await value(`
        let index = 0
        const iterator = {
          [Symbol.iterator]: () => iterator,
          next() {
            index += 1
            return index > 2 ? { done: true } : { done: false, value: Promise.resolve(index) }
          },
        }
        const values = []
        for await (const item of iterator) values.push(item)
        return values
      `),
    ).toEqual([1, 2])
  })

  test("adopts terminal and close values from synchronous iterators", async () => {
    expect(
      await value(`
        const terminal = {
          [Symbol.iterator]: () => terminal,
          next: () => ({ done: true, value: Promise.reject("terminal") }),
        }
        let terminalError
        try {
          for await (const item of terminal) {}
        } catch (error) {
          terminalError = error
        }

        const closing = {
          [Symbol.iterator]: () => closing,
          next: () => ({ done: false, value: 1 }),
          return: () => ({ done: true, value: Promise.reject("close") }),
        }
        let closeError
        try {
          for await (const item of closing) break
        } catch (error) {
          closeError = error
        }
        return [terminalError, closeError]
      `),
    ).toEqual(["terminal", "close"])
  })

  test("captures the next method when acquiring the iterator", async () => {
    expect(
      await value(`
        let count = 0
        const next = () => {
          count += 1
          if (count === 1) iterator.next = () => ({ done: true })
          return count > 2 ? { done: true } : { done: false, value: count }
        }
        const iterator = { [Symbol.iterator]: () => iterator, next }
        const values = []
        for await (const item of iterator) values.push(item)
        return values
      `),
    ).toEqual([1, 2])
  })

  test("captures synchronous iterator result fields before suspending", async () => {
    expect(
      await value(`
        let count = 0
        const result = { done: false, value: 1 }
        const iterator = {
          [Symbol.iterator]: () => iterator,
          next() {
            count += 1
            if (count > 1) return { done: true }
            Promise.resolve().then(() => {
              result.done = true
              result.value = 2
            })
            return result
          },
        }
        const values = []
        for await (const item of iterator) values.push(item)
        return values
      `),
    ).toEqual([1])
  })

  test("preserves the async close turn for a sync iterator without return", async () => {
    expect(
      await value(`
        const events = []
        const iterator = {
          [Symbol.iterator]: () => iterator,
          next: () => ({ done: false, value: 1 }),
        }
        for await (const item of iterator) {
          Promise.resolve().then(() => events.push("reaction"))
          break
        }
        events.push("after")
        return events
      `),
    ).toEqual(["reaction", "after"])
  })

  test("defers synchronous iterator protocol errors", async () => {
    expect(
      await value(`
        const events = []
        const throwing = {
          [Symbol.iterator]: () => throwing,
          next() {
            Promise.resolve().then(() => events.push("next reaction"))
            throw "next"
          },
        }
        try {
          for await (const item of throwing) {}
        } catch (error) {
          events.push("next catch")
        }

        const malformed = {
          [Symbol.iterator]: () => malformed,
          next() {
            Promise.resolve().then(() => events.push("result reaction"))
            return 1
          },
        }
        try {
          for await (const item of malformed) {}
        } catch (error) {
          events.push("result catch")
        }

        const closing = {
          [Symbol.iterator]: () => closing,
          next: () => ({ done: false, value: 1 }),
          return() {
            Promise.resolve().then(() => events.push("return reaction"))
            throw "return"
          },
        }
        try {
          for await (const item of closing) break
        } catch (error) {
          events.push("return catch")
        }
        return events
      `),
    ).toEqual(["next reaction", "next catch", "result reaction", "result catch", "return reaction", "return catch"])
  })

  test("prefers Symbol.asyncIterator over Symbol.iterator", async () => {
    expect(
      await value(`
        let done = false
        const asyncIterator = {
          next: async () => done ? { done: true } : (done = true, { done: false, value: "async" }),
        }
        const syncIterator = { next: () => ({ done: true }) }
        const iterable = {
          [Symbol.asyncIterator]: () => asyncIterator,
          [Symbol.iterator]: () => syncIterator,
        }
        const values = []
        for await (const item of iterable) values.push(item)
        return values
      `),
    ).toEqual(["async"])
  })

  test("closes a custom iterator on abrupt loop completion", async () => {
    expect(
      await value(`
        let closed = 0
        const iterator = {
          [Symbol.asyncIterator]: () => iterator,
          next: async () => ({ done: false, value: 1 }),
          return: async () => (closed += 1, { done: true }),
        }
        for await (const item of iterator) break
        try {
          for await (const item of iterator) throw "stop"
        } catch (error) {}
        return closed
      `),
    ).toBe(2)
  })

  test("preserves iterator protocol keys through object copies", async () => {
    expect(
      await value(`
        let done = false
        const iterable = {
          plain: true,
          [Symbol.asyncIterator]: () => iterable,
          next: async () => done ? { done: true } : (done = true, { done: false, value: 1 }),
        }
        const spread = { ...iterable }
        const { plain, ...rest } = iterable
        const assigned = Object.assign({}, iterable)
        const values = []
        for await (const item of spread) values.push(item)
        return [
          values,
          Object.hasOwn(spread, Symbol.asyncIterator),
          Object.hasOwn(rest, Symbol.asyncIterator),
          Object.hasOwn(assigned, Symbol.asyncIterator),
        ]
      `),
    ).toEqual([[1], true, true, true])
  })

  test("rejects malformed iterator protocol results", async () => {
    const result = await execute(`
      const iterator = {
        [Symbol.asyncIterator]: () => iterator,
        next: async () => 1,
      }
      for await (const item of iterator) {}
    `)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain("Iterator next() result must be an object")
  })

  test("rejects objects without an iterator protocol method", async () => {
    const result = await execute(`for await (const item of { values: [1, 2] }) {}`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain("or custom iterator value")
  })
})
