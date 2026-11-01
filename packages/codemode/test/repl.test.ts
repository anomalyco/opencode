import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode, Extension, Repl, Tool } from "../src/index.js"

const double = Tool.make({
  description: "Double a number",
  input: Schema.Struct({ x: Schema.Number }),
  output: Schema.Number,
  execute: ({ x }) => Effect.succeed(x * 2),
})

const host = Extension.make({ name: "host", globals: { twice: (n: number) => n * 2, make: () => ({ f: () => 1 }) } })

const repl = (options: Repl.Options = {}) => {
  const store = options.store ?? Repl.memory()
  const make = () => CodeMode.make({ tools: { math: { double } }, extensions: [host], repl: { ...options, store } })
  let runtime = make()
  return {
    store,
    run: (code: string) => Effect.runPromise(runtime.execute(code)),
    /** A new runtime over the same store, as after a process restart. */
    restart: () => {
      runtime = make()
    },
    inventory: () => Effect.runPromise(Repl.inventory(store)),
  }
}

const value = (result: CodeMode.Result) => {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const error = (result: CodeMode.Result) => (result.ok ? undefined : result.error.message)

describe("REPL mode", () => {
  test("top-level bindings persist across cells", async () => {
    const cells = repl()
    value(await cells.run(`const a = 1; let b = 2; var c = 3; function d() { return 4 }`))
    expect(value(await cells.run(`[a, b, c, d()]`))).toEqual([1, 2, 3, 4])
  })

  test("a later declaration replaces an earlier binding, and var keeps its value", async () => {
    const cells = repl()
    value(await cells.run(`const a = 1; var v = 1; function f() { return a }`))
    expect(value(await cells.run(`let a = 2; var v; [a, v, f()]`))).toEqual([2, 1, 2])
    expect(value(await cells.run(`function a() { return 3 }; const v = 4; [a(), v]`))).toEqual([3, 4])
    expect(error(await cells.run(`v = 5`))).toContain("Cannot assign to constant 'v'")
  })

  test("shared references and mutations carry over", async () => {
    const cells = repl()
    value(await cells.run(`const a = { n: 1 }; const b = a; const list = [a]`))
    value(await cells.run(`a.n = 5`))
    expect(value(await cells.run(`[b.n, list[0] === b, a === b]`))).toEqual([5, true, true])
  })

  test("functions, closures, and shared closure scopes restore in a new runtime", async () => {
    const cells = repl()
    value(
      await cells.run(`
        function counter() { let n = 0; return { inc: () => ++n, get: () => n } }
        const c = counter()
        c.inc()
        const fact = function f(k) { return k <= 1 ? 1 : k * f(k - 1) }
        function* range(n) { for (let i = 0; i < n; i++) yield i }
        const add = async (x, y) => x + y
      `),
    )
    cells.restart()
    expect(value(await cells.run(`[c.inc(), c.get(), fact(5), [...range(3)], await add(1, 2)]`))).toEqual([
      2,
      2,
      120,
      [0, 1, 2],
      3,
    ])
    cells.restart()
    expect(value(await cells.run(`c.get()`))).toBe(2)
  })

  test("built-in values, tools, and globals restore", async () => {
    const cells = repl()
    value(
      await cells.run(`
        const m = new Map([["k", { a: 1 }]])
        const s = new Set([m])
        const d = new Date(0)
        const re = /a+/g
        re.lastIndex = 2
        const url = new URL("https://example.com/a?b=1")
        const bytes = new Uint8Array([1, 2, 3])
        const err = new TypeError("boom")
        const done = Promise.resolve(7)
        const sparse = [1, , 3]
        const frozen = Object.freeze({ z: 1 })
        const numbers = [NaN, -0, -Infinity, undefined]
        const tool = tools.math.double
        const fn = twice
      `),
    )
    cells.restart()
    expect(
      value(
        await cells.run(`[
          m.get("k").a, [...s][0] === m, d.getTime(), re.lastIndex, url.searchParams.get("b"), bytes[2],
          err instanceof TypeError, err.message, await done, 1 in sparse, Object.isFrozen(frozen),
          Number.isNaN(numbers[0]), Object.is(numbers[1], -0), numbers[2], numbers[3] === undefined,
          await tool({ x: 2 }), fn(3),
        ]`),
      ),
    ).toEqual([1, true, 0, 2, "1", 3, true, "boom", 7, false, true, true, true, null, true, 4, 6])
  })

  test("unsaveable values become placeholders that name the binding and cell", async () => {
    const cells = repl()
    const saved = await cells.run(`
      const pending = new Promise(() => {})
      function* g() { yield 1 }
      const running = g()
      const holder = { f: make().f }
      let later = running
      1
    `)
    expect(saved.ok && saved.warnings?.map((warning) => warning.kind)).toEqual([
      "StateNotSaved",
      "StateNotSaved",
      "StateNotSaved",
    ])
    expect(error(await cells.run(`pending`))).toBe(
      "TypeError: `pending` from cell 1 held an un-awaited Promise, which cannot be kept between REPL cells, so it was not saved. Recompute it. (line 1, col 1)",
    )
    expect(error(await cells.run(`running.next()`))).toContain("`running` from cell 1 held a generator")
    // Two bindings to one unsaveable value share one placeholder, named by the first.
    expect(error(await cells.run(`later.next()`))).toContain("`running` from cell 1 held a generator")
    expect(error(await cells.run(`holder.f()`))).toContain("`holder.f` from cell 1 held a function")
    expect(error(await cells.run(`holder.f.name`))).toContain("`holder.f` from cell 1")
    // A lost `let` can be assigned again; redeclaring replaces any lost binding.
    expect(value(await cells.run(`later = 2; const pending = 3; [later, pending]`))).toEqual([2, 3])
  })

  test("a failed cell discards its changes", async () => {
    const cells = repl()
    value(await cells.run(`const a = { n: 1 }; let b = 1`))
    expect(error(await cells.run(`a.n = 2; b = 2; const c = 3; throw new Error("stop")`))).toBe("Error: stop")
    expect(value(await cells.run(`[a.n, b, typeof c]`))).toEqual([1, 1, "undefined"])
  })

  test("the inventory describes each binding", async () => {
    const cells = repl()
    value(await cells.run(`const user = { id: 1, name: "Ada" }; let n = 2`))
    value(await cells.run(`function greet(who) { return "hi " + who }; const p = new Promise(() => {})`))
    // In scope order: a cell's lexical declarations are bound before its hoisted functions.
    expect(await cells.inventory()).toEqual([
      {
        name: "user",
        declaration: "const",
        cell: 1,
        kind: "object",
        preview: '{ id: 1, name: "Ada" }',
        bytes: expect.any(Number),
      },
      { name: "n", declaration: "let", cell: 1, kind: "number", preview: "2", bytes: 0 },
      {
        name: "p",
        declaration: "const",
        cell: 2,
        kind: "lost",
        preview: "<lost>",
        bytes: expect.any(Number),
        lost: expect.stringContaining("`p` from cell 2 held an un-awaited Promise"),
      },
      {
        name: "greet",
        declaration: "function",
        cell: 2,
        kind: "function",
        preview: "function greet(who)",
        bytes: expect.any(Number),
      },
    ])
  })

  test("a commit stores only new and changed records", async () => {
    const records: Array<ReadonlyArray<Repl.Record>> = []
    const memory = Repl.memory()
    const store: Repl.Store = {
      ...memory,
      write: (commit, written) => {
        records.push(written)
        return memory.write(commit, written)
      },
    }
    const cells = repl({ store })
    value(await cells.run(`const items = Array.from({ length: 50 }, (_, i) => ({ i }))`))
    value(await cells.run(`items[3].i = -1`))
    value(await cells.run(`1`))
    expect(records.map((written) => written.length)).toEqual([51 + 1, 1, 0])
  })

  test("state over the size limit is not saved and the cell says so", async () => {
    const cells = repl({ maxStateBytes: 1_000 })
    value(await cells.run(`const small = 1`))
    const result = await cells.run(`const big = "x".repeat(5_000); big.length`)
    expect(result).toMatchObject({ ok: true, value: 5_000 })
    expect(result.ok && result.warnings?.[0]?.message).toContain("passed the 1000-byte limit while saving `big`")
    expect(value(await cells.run(`[small, typeof big]`))).toEqual([1, "undefined"])
  })

  test("a cell that started from an old head is not saved", async () => {
    const store = Repl.memory()
    const cells = repl({ store })
    value(await cells.run(`const a = 1`))
    const old = await Effect.runPromise(store.head())
    value(await cells.run(`const b = 2`))
    // A second runtime that read the head before the first committed again.
    const stale = repl({ store: { ...store, head: () => Effect.succeed(old) } })
    const result = await stale.run(`const c = 3`)
    expect(result.ok && result.warnings?.[0]?.message).toContain("another cell committed")
    expect(value(await cells.run(`[a, b, typeof c]`))).toEqual([1, 2, "undefined"])
  })

  test("the timeout applies to each cell and a timed-out cell commits nothing", async () => {
    const store = Repl.memory()
    const runtime = CodeMode.make({ repl: { store }, limits: { timeoutMs: 50 } })
    await Effect.runPromise(runtime.execute(`let n = 1`))
    const result = await Effect.runPromise(runtime.execute(`n = 2; while (true) {}`))
    expect(result.ok ? undefined : result.error.kind).toBe("TimeoutExceeded")
    expect(await Effect.runPromise(runtime.execute(`n`))).toMatchObject({ value: 1 })
  })

  test("a store that cannot be restored fails the cell clearly", async () => {
    const store = Repl.memory()
    const cells = repl({ store })
    value(await cells.run(`const a = { n: 1 }`))
    const broken: Repl.Store = { ...store, read: () => Effect.succeed([]) }
    const result = await repl({ store: broken }).run(`a`)
    expect(error(result)).toContain("REPL state could not be restored from commit")
  })

  test("changes to built-ins are reported as not kept", async () => {
    const cells = repl()
    const result = await cells.run(`Array.prototype.total = function () { return 1 }; 1`)
    expect(result.ok && result.warnings?.[0]?.message).toContain("Array.prototype")
  })

  test("cells of one runtime run one at a time", async () => {
    const runtime = CodeMode.make({ repl: true })
    await Effect.runPromise(runtime.execute(`let n = 0`))
    await Effect.runPromise(
      Effect.all(
        Array.from({ length: 5 }, () => runtime.execute(`n = n + 1`)),
        { concurrency: "unbounded" },
      ),
    )
    expect(await Effect.runPromise(runtime.execute(`n`))).toMatchObject({ value: 5 })
  })

  test("without REPL mode, nothing carries over", async () => {
    const runtime = CodeMode.make({})
    await Effect.runPromise(runtime.execute(`const a = 1`))
    expect(await Effect.runPromise(runtime.execute(`typeof a`))).toMatchObject({ value: "undefined" })
  })
})
