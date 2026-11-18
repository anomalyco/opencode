import { describe, expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { Host, Runtime, toBytes } from "../src/language/index.js"

// The language layer on its own: host functions, namespaces, failures, and per-run state, with no tools.

const run = <R>(runtime: Runtime.Runtime<R>, code: string) =>
  Effect.runPromise(runtime.execute(code) as Effect.Effect<Runtime.Result>)

const value = async <R>(runtime: Runtime.Runtime<R>, code: string) => {
  const result = await run(runtime, code)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

/** A latch the test opens by hand. */
const latch = <A = void>() => {
  let resolve!: (value: A) => void
  const promise = new Promise<A>((done) => (resolve = done))
  return { promise, resolve }
}

describe("Host.fn", () => {
  test("a sync function returns its value, or blocks on an Effect, before the next statement", async () => {
    const runtime = Runtime.make({
      globals: () => ({
        double: Host.fn(([n]) => (n as number) * 2),
        later: Host.fn(([n]) => Effect.succeed((n as number) + 1)),
      }),
    })
    expect(await value(runtime, `const a = double(2); const b = later(a); return [a, b, typeof double]`)).toEqual([
      4,
      5,
      "function",
    ])
  })

  test("an async function hands the program a promise", async () => {
    const runtime = Runtime.make({ globals: () => ({ load: Host.fn(([n]) => Effect.succeed(n), { type: "async" }) }) })
    expect(await value(runtime, `const p = load(1); return [p instanceof Promise, await p]`)).toEqual([true, 1])
  })

  test("a sync-thenable result can be used directly, awaited, or chained", async () => {
    const runtime = Runtime.make({
      globals: () => ({ find: Host.fn(() => Effect.succeed({ items: [1, 2] }), { type: "sync-thenable" }) }),
    })
    expect(
      await value(
        runtime,
        `return [find().items.length, (await find()).items.length, await find().then((r) => r.items[1]), Object.keys(find())]`,
      ),
    ).toEqual([2, 2, 2, ["items"]])
  })

  test("every call gets its key, <runId>:<callId>", async () => {
    const keys: Array<string> = []
    const runtime = Runtime.make({ globals: () => ({ note: Host.fn((_, call) => void keys.push(call.key)) }) })
    await Effect.runPromise(runtime.program(`note(); note()`, { runId: "r" }).run())
    expect(keys).toEqual(["r:0", "r:1"])
  })

  test("arguments and results cross as structured copies", async () => {
    let seen: unknown
    const runtime = Runtime.make({
      globals: () => ({
        keep: Host.fn(([input]) => {
          seen = input
          return { when: new Date(0), tags: new Set(["a"]), read: () => "called" }
        }),
      }),
    })
    expect(
      await value(
        runtime,
        `const r = keep({ at: new Date(5), m: new Map([["k", 1]]) }); return [r.when.getTime(), r.tags.has("a"), r.read()]`,
      ),
    ).toEqual([0, true, "called"])
    expect(seen).toEqual({ at: new Date(5), m: new Map([["k", 1]]) })
  })

  test("a function inside a result crosses back as itself only to a function that takes functions", async () => {
    const read = () => "called"
    const runtime = Runtime.make({
      globals: () => ({
        open: Host.fn(() => ({ read })),
        takes: Host.fn(([input]) => (input as { readonly read: unknown }).read === read, { takesFunctions: true }),
        refuses: Host.fn(() => true),
      }),
    })
    expect(await value(runtime, `return takes({ read: open().read })`)).toBe(true)
    for (const code of [`refuses(open().read)`, `takes(takes)`, `takes(() => 1)`]) {
      expect(await run(runtime, code)).toMatchObject({
        ok: false,
        error: { message: expect.stringContaining("contains a function, which cannot be passed to the host") },
      })
    }
  })

  test("a constructible function is called by new, and gives what it returns", async () => {
    const runtime = Runtime.make({
      globals: () => ({
        Box: Host.fn(([item]) => ({ item }), { constructible: true }),
        Later: Host.fn(([item]) => Effect.succeed({ item }), { constructible: true }),
        plain: Host.fn(() => 1),
      }),
    })
    expect(await value(runtime, `return [new Box(1).item, new Later(2).item, new Later(...[3]).item]`)).toEqual([
      1, 2, 3,
    ])
    expect(await run(runtime, `new plain()`)).toMatchObject({ ok: false })
  })

  test("idempotent applies only to async functions", () => {
    // @ts-expect-error a sync function can't be idempotent
    Host.fn(() => 1, { idempotent: true })
    // @ts-expect-error a sync-thenable function can't be idempotent
    Host.fn(() => 1, { type: "sync-thenable", idempotent: true })
    expect(Host.fn(() => 1, { type: "async", idempotent: true }).idempotent).toBe(true)
  })
})

describe("Host.namespace and Host.fail", () => {
  const api = Host.namespace({
    keys: (path) => (path.length === 0 ? ["issues"] : ["list"]),
    resolve: (path) =>
      path.join(".") === "issues.list"
        ? Host.fn(() => Effect.succeed(["#1"]), { type: "async" })
        : Host.missing(`No api.${path.join(".")}`, ["Try api.issues.list."], "NotFound"),
  })
  const runtime = Runtime.make({
    globals: () => ({ api, refuse: Host.fn(() => Effect.fail(Host.fail("Refused", "Not today", ["Ask again."]))) }),
  })

  test("a namespace is a lazy, path-addressed object of functions", async () => {
    expect(
      await value(runtime, `return [await api.issues.list(), Object.keys(api), Object.keys(api.issues), typeof api.x]`),
    ).toEqual([["#1"], ["issues"], ["list"], "function"])
  })

  test("a missing function and a host failure keep their kind and suggestions", async () => {
    expect(await run(runtime, `return api.issues.nope()`)).toMatchObject({
      ok: false,
      error: { kind: "NotFound", message: "No api.issues.nope", suggestions: ["Try api.issues.list."] },
    })
    expect(await run(runtime, `refuse()`)).toMatchObject({
      ok: false,
      error: { kind: "Refused", message: "Not today", suggestions: ["Ask again."] },
    })
  })
})

describe("per-run state", () => {
  test("run.metadata is the result's, and a resumed run gets it back with fresh globals", async () => {
    const gate = latch()
    const waiting = latch()
    let made = 0
    const runtime = Runtime.make({
      globals: (run) => {
        made++
        const state = (run.metadata ??= { count: 0 }) as { count: number }
        return {
          count: Host.fn(() => ++state.count),
          wait: Host.fn(
            () =>
              Effect.andThen(
                Effect.sync(waiting.resolve),
                Effect.promise(() => gate.promise),
              ),
            { type: "async", idempotent: true },
          ),
        }
      },
    })
    const program = runtime.program(`count(); count(); await wait(); return count()`, { runId: "m" })
    const fiber = Effect.runFork(program.run())
    await waiting.promise
    const suspended = await Effect.runPromise(program.suspend())
    if (suspended.ok !== "suspended") throw new Error("expected a suspended run")
    expect(suspended.state.header.metadata).toEqual({ count: 2 })
    expect(await Effect.runPromise(Fiber.join(fiber))).toBe(suspended)
    gate.resolve()
    expect(await Effect.runPromise(runtime.resume(toBytes(suspended.state)).run())).toMatchObject({
      ok: true,
      value: 3,
      metadata: { count: 3 },
    })
    // Made at the start and at the resume (and at every step in the round-trip test mode).
    expect(made).toBeGreaterThanOrEqual(2)
  })

  test("a suspend fails while a call that isn't idempotent runs", async () => {
    const called = latch()
    const runtime = Runtime.make({
      globals: () => ({
        slow: Host.fn(() => Effect.andThen(Effect.sync(called.resolve), Effect.never), { type: "async" }),
      }),
    })
    const program = runtime.program(`await slow()`)
    const fiber = Effect.runFork(program.run())
    await called.promise
    const error = await Effect.runPromise(Effect.flip(program.suspend()))
    expect(error.running).toMatchObject([{ path: "slow" }])
    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  test("a suspend fails while a call holds a host function, even an idempotent one", async () => {
    const called = latch()
    const runtime = Runtime.make({
      globals: () => ({
        open: Host.fn(() => ({ read: () => "called" })),
        slow: Host.fn(() => Effect.andThen(Effect.sync(called.resolve), Effect.never), {
          type: "async",
          idempotent: true,
          takesFunctions: true,
        }),
      }),
    })
    const program = runtime.program(`await slow(open().read)`)
    const fiber = Effect.runFork(program.run())
    await called.promise
    const error = await Effect.runPromise(Effect.flip(program.suspend()))
    expect(error.running).toMatchObject([{ path: "slow" }])
    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  test("a durable function keeps running across a suspend and is waited on again", async () => {
    const jobs = new Map<string, ReturnType<typeof latch<number>>>()
    const waiting = latch()
    const runtime = Runtime.make({
      globals: () => ({
        job: Host.durableFn({
          start: (_, call) => Effect.sync(() => (jobs.set(call.key, latch<number>()), call.key)),
          wait: (key) =>
            Effect.andThen(
              Effect.sync(waiting.resolve),
              Effect.promise(() => jobs.get(key)!.promise),
            ),
          cancel: () => Effect.void,
        }),
      }),
    })
    const program = runtime.program(`return (await job()) + 1`, { runId: "d" })
    const fiber = Effect.runFork(program.run())
    // In `wait`, so the call is started and its data saved.
    await waiting.promise
    const suspended = await Effect.runPromise(program.suspend())
    if (suspended.ok !== "suspended") throw new Error("expected a suspended run")
    await Effect.runPromise(Fiber.join(fiber))
    const resumed = Effect.runPromise(runtime.resume(suspended.state).run())
    jobs.get("d:0")!.resolve(41)
    expect(await resumed).toMatchObject({ ok: true, value: 42 })
  })
})

describe("translate", () => {
  const translating = (translate?: Runtime.Translate, limits?: Runtime.Limits) => {
    const calls: Array<ReadonlyArray<unknown>> = []
    const runtime = Runtime.make({
      translate,
      limits,
      globals: () => ({
        keep: Host.fn((args) => void calls.push(args)),
        send: Host.fn((args) => Effect.sync(() => void calls.push(args)), { type: "async" }),
        later: Host.fn(([n]) => Effect.succeed(n), { type: "async" }),
        never: Host.fn(() => Effect.never, { type: "async" }),
      }),
    })
    return { runtime, calls }
  }

  test("by default, a function or a promise inside an argument fails the call", async () => {
    const strict = translating().runtime
    for (const [code, message] of [
      ["keep({ f() {} })", "Argument 1 to keep contains a function, which cannot be passed to the host."],
      ["keep([Promise.resolve(1)])", "Argument 1 to keep contains an un-awaited Promise, which cannot be passed"],
      ["await send(() => 1)", "Argument 1 to send contains a function"],
    ] as const) {
      const result = await run(strict, code)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.message).toContain(message)
    }
  })

  test("functions: drop leaves functions out as JSON.stringify does", async () => {
    const { runtime, calls } = translating({ functions: "drop" })
    await value(
      runtime,
      `keep({ q: "x", format(v) { return v }, nested: { f: Math.max } }, [1, () => 2, keep], () => 3, new Map([["k", () => 1]]))`,
    )
    expect(calls).toEqual([[{ q: "x", nested: {} }, [1, null, null], undefined, new Map([["k", undefined]])]])
    expect(Object.keys(calls[0]![0] as object)).toEqual(["q", "nested"])
    const result = await run(runtime, `keep({ p: Promise.resolve(1) })`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("un-awaited Promise")
  })

  test("promises: await waits for every promise inside the arguments and uses its value", async () => {
    const { runtime, calls } = translating({ promises: "await" })
    expect(
      await value(
        runtime,
        `
          const slow = (async () => { await null; await null; return "slow" })()
          const a = keep({ n: Promise.resolve(5), list: [later(1), slow] }, later({ deep: later(2) }))
          const b = await send(slow, new Promise((resolve) => resolve(later(3))))
          return [a, b]
        `,
      ),
    ).toEqual([null, null])
    expect(calls).toEqual([[{ n: 5, list: [1, "slow"] }, { deep: 2 }], ["slow", 3]])
    const result = await run(runtime, `keep({ f() {} })`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("contains a function")
  })

  test("promises: await fails the call with a rejection's reason", async () => {
    const { runtime, calls } = translating({ promises: "await" })
    expect(
      await value(
        runtime,
        `
          const failing = () => Promise.reject(new RangeError("nope"))
          let thrown
          try { keep({ n: failing() }) } catch (error) { thrown = error }
          const sent = send([later(1), failing()])
          return [thrown instanceof RangeError, thrown.message, sent instanceof Promise, await sent.catch((e) => e.message)]
        `,
      ),
    ).toEqual([true, "nope", true, "nope"])
    expect(calls).toEqual([])
  })

  test("promises: await waits on a promise that never settles until the timeout", async () => {
    const result = await run(translating({ promises: "await" }, { timeoutMs: 50 }).runtime, `keep({ n: never() })`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe("TimeoutExceeded")
  })

  test("promises: await keeps waiting across a suspend", async () => {
    const started = latch()
    const gate = latch<number>()
    const calls: Array<ReadonlyArray<unknown>> = []
    const runtime = Runtime.make({
      translate: { promises: "await" },
      globals: () => ({
        keep: Host.fn((args) => (calls.push(args), "kept")),
        slow: Host.fn(
          () => Effect.andThen(Effect.sync(started.resolve), Effect.promise(() => gate.promise)),
          { type: "async", idempotent: true },
        ),
      }),
    })
    const program = runtime.program(`return [keep({ n: slow() }), await slow()]`)
    const fiber = Effect.runFork(program.run())
    await started.promise
    const suspended = await Effect.runPromise(program.suspend())
    if (suspended.ok !== "suspended") throw new Error("expected a suspended run")
    await Effect.runPromise(Fiber.join(fiber))
    expect(calls).toEqual([])
    const resumed = Effect.runPromise(runtime.resume(suspended.state).run())
    gate.resolve(7)
    expect(await resumed).toMatchObject({ ok: true, value: ["kept", 7] })
    expect(calls).toEqual([[{ n: 7 }]])
  })
})
