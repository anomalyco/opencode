import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Host, Runtime } from "../src/language/index.js"

// Program getters crossing to the host: they run (once per receiver and key) before the host function does, their
// values cross as data, and setter-only properties are left out.

const run = <R>(runtime: Runtime.Runtime<R>, code: string) =>
  Effect.runPromise(runtime.execute(code) as Effect.Effect<Runtime.Result>)

const value = async <R>(runtime: Runtime.Runtime<R>, code: string) => {
  const result = await run(runtime, code)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

const translating = (translate?: Runtime.Translate) => {
  const calls: Array<ReadonlyArray<unknown>> = []
  const keys: Array<string> = []
  const runtime = Runtime.make({
    translate,
    globals: () => ({
      keep: Host.fn((args, call) => {
        keys.push(call.key)
        calls.push(args)
        return args.length
      }),
      send: Host.fn(
        (args, call) =>
          Effect.sync(() => {
            keys.push(call.key)
            calls.push(args)
            return "sent"
          }),
        { type: "async" },
      ),
      later: Host.fn(([n]) => Effect.succeed(n), { type: "async" }),
      ns: Host.namespace({
        keys: () => ["echo"],
        resolve: () => Host.fn((args) => args[0]),
      }),
    }),
  })
  return { runtime, calls, keys }
}

describe("getters crossing to the host", () => {
  test("a getter's value crosses as data and a setter-only property is left out", async () => {
    const { runtime, calls } = translating()
    expect(
      await value(
        runtime,
        `let n = 0
        const o = { a: 1, get b() { n++; return { c: [n] } }, set d(v) {}, get e() { n++ } }
        keep(o, [o.b])
        return n`,
      ),
    ).toBe(3)
    expect(calls).toEqual([[{ a: 1, b: { c: [2] }, e: undefined }, [{ c: [1] }]]])
    expect(Object.keys(calls[0]![0] as object)).toEqual(["a", "b", "e"])
  })

  test("each getter runs once per crossing, nested getters too, and errors cross with getter fields", async () => {
    const { runtime, calls } = translating()
    expect(
      await value(
        runtime,
        `const log = []
        const inner = { get y() { log.push("y"); return 2 } }
        const o = { get x() { log.push("x"); return inner } }
        const e = new Error("boom")
        e.detail = { get why() { log.push("why"); return "because" } }
        keep(o, o, [inner], e)
        return log`,
      ),
    ).toEqual(["x", "y", "why"])
    expect(calls[0]!.slice(0, 3)).toEqual([{ x: { y: 2 } }, { x: { y: 2 } }, [{ y: 2 }]])
    expect((calls[0]![3] as { detail: unknown }).detail).toEqual({ why: "because" })
  })

  test("a getter that throws fails the call before the host function runs", async () => {
    const { runtime, calls } = translating()
    expect(
      await value(runtime, `try { keep({ get x() { throw new Error("no") } }) } catch (e) { return e.message }`),
    ).toBe("no")
    expect(calls).toEqual([])
  })

  test("a getter that throws rejects an async call's promise, and a sync call still throws", async () => {
    const { runtime, calls, keys } = translating()
    expect(
      await value(
        runtime,
        `const bad = { get x() { throw new Error("boom") } }
        const caught = await send(bad).catch((e) => e.message)
        const settled = await Promise.allSettled([send(bad), send(2)])
        let sync
        try { keep(bad) } catch (e) { sync = e.message }
        return [caught, settled.map((s) => s.status), sync, keep(3)]`,
      ),
    ).toEqual(["boom", ["rejected", "fulfilled"], "boom", 1])
    expect(calls).toEqual([[2], [3]])
    expect(keys.map((key) => key.split(":")[1])).toEqual(["0", "1"])
  })

  test("an async host function returns its promise at once, and getter rounds take no call ids", async () => {
    const { runtime, calls, keys } = translating()
    expect(
      await value(
        runtime,
        `const p = send({ get a() { return { get b() { return 1 } } } })
        const q = keep(1)
        return [p instanceof Promise, await p, q]`,
      ),
    ).toEqual([true, "sent", 1])
    // The async call is queued first and runs after the sync one; neither id went to a getter round.
    expect(calls).toEqual([[1], [{ a: { b: 1 } }]])
    expect(keys.map((key) => key.split(":")[1])).toEqual(["1", "0"])
  })

  test("with promises: await, getters run first, then the promises they return are awaited", async () => {
    const { runtime, calls } = translating({ promises: "await" })
    expect(
      await value(
        runtime,
        `let n = 0
        const o = { get p() { n++; return later({ get q() { n++; return 3 } }) } }
        keep(o)
        return n`,
      ),
    ).toBe(2)
    expect(calls).toEqual([[{ p: { q: 3 } }]])
  })

  test("with promises: await, a sync call inside a generator or the result's getters waits there", async () => {
    const { runtime, calls } = translating({ promises: "await" })
    expect(
      await value(
        runtime,
        `function* g() { yield keep(later(1)) }
        return [[...g()], { get x() { return keep(later(2)) } }]`,
      ),
    ).toEqual([[1], { x: 1 }])
    expect(calls).toEqual([[1], [2]])
  })

  test("functions: drop applies to a getter's value", async () => {
    const { runtime, calls } = translating({ functions: "drop" })
    await value(runtime, `keep({ get f() { return () => 1 }, a: 1 })`)
    expect(calls).toEqual([[{ a: 1 }]])
  })

  test("a namespace call reads getter arguments ahead too", async () => {
    const { runtime } = translating()
    expect(await value(runtime, `return ns.echo({ get v() { return 4 } })`)).toEqual({ v: 4 })
  })

  test("a circular getter is refused", async () => {
    const { runtime } = translating()
    const result = await run(runtime, `const o = { get self() { return o } }; keep(o)`)
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining("circular") } })
  })
})

describe("accessor flags on copies", () => {
  test("an awaited sync-thenable copy keeps its getters", async () => {
    const runtime = Runtime.make({
      globals: () => ({ find: Host.fn(() => Effect.succeed({ a: 1 }), { type: "sync-thenable" }) }),
    })
    expect(
      await value(
        runtime,
        `const r = find()
        Object.defineProperty(r, "x", { get() { return 42 }, enumerable: true })
        const copy = await r
        console.log(copy)
        return [JSON.stringify(copy), Object.entries(copy), { ...copy }]`,
      ),
    ).toEqual(['{"a":1,"x":42}', [["a", 1], ["x", 42]], { a: 1, x: 42 }])
  })

  test("an Error.prototype getter is called when an error is converted", async () => {
    const runtime = Runtime.make({ globals: () => ({}) })
    const setup = `Object.defineProperty(Error.prototype, "name", { get() { return "Custom" }, configurable: true })`
    expect(await value(runtime, `${setup}; return JSON.stringify(new Error("hi"))`)).toBe(
      '{"name":"Custom","message":"hi"}',
    )
    expect(await value(runtime, `${setup}; return new Error("hi")`)).toEqual({ name: "Custom", message: "hi" })
  })
})

describe("class instances crossing to the host", () => {
  const classes = `
    class Base { a = 1; get proto() { return "left" } m() { return 1 } }
    class Item extends Base { constructor() { super(); this.b = 2; Object.defineProperty(this, "own", { get() { return 3 }, enumerable: true }); Object.defineProperty(this, "w", { set(v) {}, enumerable: true }) } }`

  test("as tool arguments: own enumerable fields and own getters, no prototype methods or getters", async () => {
    const { runtime, calls } = translating()
    await value(runtime, `${classes}; keep(new Item(), [new Base()])`)
    expect(calls).toEqual([[{ a: 1, b: 2, own: 3 }, [{ a: 1 }]]])
  })

  test("as the result", async () => {
    const { runtime } = translating()
    expect(await value(runtime, `${classes}; return { item: new Item() }`)).toEqual({ item: { a: 1, b: 2, own: 3 } })
  })

  test("a class constructor follows the function rule", async () => {
    expect(await value(translating({ functions: "drop" }).runtime, `class A {}; return { A, n: 1 }`)).toEqual({ n: 1 })
    const strict = await run(translating().runtime, `class A {}; keep(A)`)
    expect(strict.ok).toBe(false)
  })
})
