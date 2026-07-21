/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/language/expressions/yield/yield-as-expression.js
 * - test/language/expressions/yield/yield-star-getiter-method.js
 * - test/language/expressions/yield/yield-star-return-then-get-abrupt.js
 * - test/language/statements/generators/try-catch-finally.js
 * - test/language/statements/async-generator/yield-promise-reject-next-catch.js
 * - test/language/statements/async-generator/yield-return-then-get-abrupt.js
 * - test/built-ins/AsyncGeneratorPrototype/next/returns-promise.js
 *
 * Copyright (C) 2015-2019 the V8 project authors and Ecma International. All rights reserved.
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

describe("confined generators", () => {
  test("is lazy and preserves next(value), nested suspension, return, and exhaustion", async () => {
    expect(
      await value(`
        const events = []
        function* generate() {
          events.push("start")
          const received = yield 1 + (yield 2)
          return received
        }
        const iterator = generate()
        const before = events.slice()
        const first = iterator.next(99)
        const second = iterator.next(3)
        const third = iterator.next(7)
        const fourth = iterator.next(8)
        return [before, events, first, second, third, fourth]
      `),
    ).toEqual([
      [],
      ["start"],
      { value: 2, done: false },
      { value: 4, done: false },
      { value: 7, done: true },
      { value: null, done: true },
    ])
  })

  test("routes throw and return through catch and finally", async () => {
    expect(
      await value(`
        function* generate() {
          try {
            try { yield "try" } catch (error) { yield "caught " + error }
          } finally {
            yield "finally"
          }
        }
        const iterator = generate()
        return [iterator.next(), iterator.throw("boom"), iterator.return("done"), iterator.next()]
      `),
    ).toEqual([
      { value: "try", done: false },
      { value: "caught boom", done: false },
      { value: "finally", done: false },
      { value: "done", done: true },
    ])
  })

  test("throws into a suspended generator and after exhaustion", async () => {
    expect(
      await value(`
        function* generate() { yield 1 }
        const iterator = generate()
        iterator.next()
        let suspended
        let exhausted
        try { iterator.throw("first") } catch (error) { suspended = error }
        try { iterator.throw("second") } catch (error) { exhausted = error }
        return [suspended, exhausted, iterator.next()]
      `),
    ).toEqual(["first", "second", { value: null, done: true }])
  })

  test("rejects synchronous generator reentry", async () => {
    expect(
      await value(`
        let iterator
        function* generate() {
          try { iterator.next() } catch (error) { return error.name }
        }
        iterator = generate()
        return iterator.next()
      `),
    ).toEqual({ value: "TypeError", done: true })
  })

  test("delegates yield*, forwards next values, and receives the delegate return value", async () => {
    expect(
      await value(`
        function* inner() {
          const input = yield 1
          return input * 2
        }
        function* outer() {
          const result = yield* inner()
          return result + 1
        }
        const iterator = outer()
        return [iterator.next(), iterator.next(4)]
      `),
    ).toEqual([
      { value: 1, done: false },
      { value: 9, done: true },
    ])
  })

  test("delegates throw and return to custom iterators", async () => {
    expect(
      await value(`
        const calls = []
        let step = 0
        const delegate = {
          [Symbol.iterator]: () => delegate,
          next(...args) {
            calls.push(["next", args.length, args[0]])
            step += 1
            return step === 1 ? { value: "one", done: false } : { value: "end", done: true }
          },
          throw(value) {
            calls.push(["throw", value])
            return { value: "recovered", done: false }
          },
          return(value) {
            calls.push(["return", value])
            return { value: value + "!", done: true }
          },
        }
        function* generate() { return yield* delegate }
        const iterator = generate()
        const first = iterator.next()
        const second = iterator.throw("x")
        const third = iterator.return("stop")
        return [first, second, third, calls]
      `),
    ).toEqual([
      { value: "one", done: false },
      { value: "recovered", done: false },
      { value: "stop!", done: true },
      [
        ["next", 0, null],
        ["throw", "x"],
        ["return", "stop"],
      ],
    ])
  })

  test("uses the missing-throw delegation path for built-in iterables", async () => {
    expect(
      await value(`
        function* generate() { yield* [1, 2] }
        const iterator = generate()
        iterator.next()
        try { iterator.throw("boom") } catch (error) { return error.name }
      `),
    ).toBe("TypeError")
  })

  test("exposes only the appropriate iterator symbol and works in for...of", async () => {
    expect(
      await value(`
        function* generate() { yield 1; yield 2 }
        const iterator = generate()
        const symbols = [iterator[Symbol.iterator]() === iterator, iterator[Symbol.asyncIterator]]
        const values = []
        for (const item of iterator) values.push(item)
        return [symbols, values]
      `),
    ).toEqual([
      [true, null],
      [1, 2],
    ])
  })

  test("accepts generator methods as iterator acquisition results", async () => {
    expect(
      await value(`
        const sync = {
          *[Symbol.iterator]() { yield 1; yield 2 },
        }
        const asynchronous = {
          async *[Symbol.asyncIterator]() { yield 3; yield 4 },
        }
        const values = []
        for (const item of sync) values.push(item)
        for await (const item of asynchronous) values.push(item)
        return values
      `),
    ).toEqual([1, 2, 3, 4])
  })

  test("closes a generator when for...of exits abruptly", async () => {
    expect(
      await value(`
        const events = []
        function* generate() {
          try { yield 1; yield 2 } finally { events.push("closed") }
        }
        for (const item of generate()) break
        return events
      `),
    ).toEqual(["closed"])
  })

  test("async generator requests are promises and execute in request order", async () => {
    expect(
      await value(`
        const events = []
        async function* generate() {
          events.push("start")
          const input = yield Promise.resolve(1)
          events.push("received " + input)
          return Promise.resolve(3)
        }
        const iterator = generate()
        const first = iterator.next()
        const second = iterator.next(2)
        const third = iterator.next(4)
        const promiseFlags = [first instanceof Promise, second instanceof Promise, third instanceof Promise]
        return [promiseFlags, await Promise.all([first, second, third]), events]
      `),
    ).toEqual([
      [true, true, true],
      [
        { value: 1, done: false },
        { value: 3, done: true },
        { value: null, done: true },
      ],
      ["start", "received 2"],
    ])
  })

  test("keeps requests queued while a completed generator adopts return values", async () => {
    expect(
      await value(`
        const events = []
        let resolve
        const pending = new Promise((done) => { resolve = done })
        async function* generate() { return 1 }
        const iterator = generate()
        const first = iterator.next()
        const returned = iterator.return(pending)
        const later = first.then(() => iterator.next()).then(() => events.push("later"))
        returned.then(() => events.push("returned"))
        await first
        await Promise.resolve()
        const before = events.slice()
        resolve(9)
        await Promise.all([returned, later])
        return [before, events]
      `),
    ).toEqual([[], ["returned", "later"]])
  })

  test("serializes requests made after async generator exhaustion", async () => {
    expect(
      await value(`
        const events = []
        let resolve
        const pending = new Promise((done) => { resolve = done })
        async function* generate() { return 1 }
        const iterator = generate()
        await iterator.next()
        const returned = iterator.return(pending).then(() => events.push("returned"))
        const later = iterator.next().then(() => events.push("later"))
        await Promise.resolve()
        const before = events.slice()
        resolve(9)
        await Promise.all([returned, later])
        return [before, events]
      `),
    ).toEqual([[], ["returned", "later"]])
  })

  test("async generators adopt yielded, returned, and return-request promises", async () => {
    expect(
      await value(`
        async function* yielded() { yield Promise.resolve(1) }
        async function* returned() { return Promise.resolve(2) }
        async function* pending() { yield 0 }
        const first = yielded()
        const second = returned()
        const third = pending()
        const exhausted = returned()
        await third.next()
        await exhausted.next()
        return await Promise.all([
          first.next(),
          second.next(),
          third.return(Promise.resolve(3)),
          exhausted.return(Promise.resolve(4)),
        ])
      `),
    ).toEqual([
      { value: 1, done: false },
      { value: 2, done: true },
      { value: 3, done: true },
      { value: 4, done: true },
    ])
  })

  test("awaits return-request promises before injecting completion", async () => {
    expect(
      await value(`
        const events = []
        async function* generate() {
          try {
            yield 1
          } catch (error) {
            events.push("caught " + error)
            yield "recovered"
          } finally {
            events.push("finally")
          }
        }
        const iterator = generate()
        const first = await iterator.next()
        const returned = await iterator.return(Promise.reject("bad"))
        const beforeNext = events.slice()
        const last = await iterator.next()
        return [first, returned, beforeNext, last, events]
      `),
    ).toEqual([
      { value: 1, done: false },
      { value: "recovered", done: false },
      ["caught bad"],
      { value: null, done: true },
      ["caught bad", "finally"],
    ])
  })

  test("loop consumers call iterator next with no arguments", async () => {
    expect(
      await value(`
        const calls = []
        let syncStep = 0
        const sync = {
          [Symbol.iterator]: () => sync,
          next(...args) {
            calls.push(["sync", args.length])
            syncStep += 1
            return { value: syncStep, done: syncStep > 1 }
          },
        }
        let asyncStep = 0
        const asynchronous = {
          [Symbol.asyncIterator]: () => asynchronous,
          async next(...args) {
            calls.push(["async", args.length])
            asyncStep += 1
            return { value: asyncStep, done: asyncStep > 1 }
          },
        }
        for (const item of sync) {}
        for await (const item of asynchronous) {}
        return calls
      `),
    ).toEqual([
      ["sync", 0],
      ["sync", 0],
      ["async", 0],
      ["async", 0],
    ])
  })

  test("supports async generators in for await...of and keeps them out of for...of", async () => {
    expect(
      await value(`
        async function* generate() { yield 1; yield await Promise.resolve(2) }
        const values = []
        for await (const item of generate()) values.push(item)
        let name
        try { for (const item of generate()) {} } catch (error) { name = error.name }
        return [values, name]
      `),
    ).toEqual([[1, 2], "TypeError"])
  })

  test("keeps generator references opaque at the data boundary", async () => {
    const result = await execute(`function* generate() { yield 1 } return generate()`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("InvalidDataValue")
  })
})
