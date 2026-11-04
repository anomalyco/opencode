import { describe, expect, test } from "bun:test"
import { Glob } from "bun"
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"
import { stats } from "../src/machine/task.js"

// The machine evaluator (`src/machine`) runs programs as explicit frames. These run each program on both evaluators,
// check the machine really ran it, and check both give the same result.

const runtime = CodeMode.make({
  tools: {
    echo: Tool.make({
      description: "Echo a value",
      input: Schema.Struct({ value: Schema.Number }),
      output: Schema.Number,
      execute: ({ value }) => Effect.succeed(value),
    }),
  },
})

const run = async (code: string, evaluator: "machine" | "legacy") => {
  const previous = process.env.CODEMODE_EVALUATOR
  process.env.CODEMODE_EVALUATOR = evaluator
  try {
    return await Effect.runPromise(runtime.execute(code))
  } finally {
    if (previous === undefined) delete process.env.CODEMODE_EVALUATOR
    else process.env.CODEMODE_EVALUATOR = previous
  }
}

const both = async (code: string) => {
  const legacy = await run(code, "legacy")
  const before = stats.steps
  const machine = await run(code, "machine")
  expect(stats.steps).toBeGreaterThan(before)
  expect(machine).toEqual(legacy)
  return machine
}

const value = async (code: string) => {
  const result = await both(code)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

const error = async (code: string) => {
  const result = await both(code)
  if (result.ok) throw new Error(`expected failure, got value ${JSON.stringify(result.value)}`)
  return result.error
}

describe("machine evaluator", () => {
  test("runs programs as frames, and the generator evaluator runs none", async () => {
    const before = stats.steps
    await run(`return 1 + 2`, "legacy")
    expect(stats.steps).toBe(before)
    expect(await value(`const f = (n) => (n < 2 ? n : f(n - 1) + f(n - 2)); return f(12)`)).toBe(144)
  })

  test("try/catch/finally around program calls, with finally overriding the completion", async () => {
    expect(
      await value(`
        const boom = () => { throw new Error("boom") }
        const log = []
        const f = () => { try { boom() } catch (e) { log.push(e.message); return "caught" } finally { log.push("finally") } }
        const g = () => { try { return f() } finally { return "override" } }
        return [g(), log]
      `),
    ).toEqual(["override", ["boom", "finally"]])
  })

  test("a failure in a for...of body closes the iterator and keeps the failure", async () => {
    expect(
      await value(`
        const log = []
        const iterable = { [Symbol.iterator]() {
          let i = 0
          return { next: () => ({ done: i > 3, value: i++ }), return: () => { log.push("closed"); return {} } }
        } }
        const check = (x) => { if (x === 2) throw new Error("at " + x) }
        try { for (const x of iterable) { log.push(x); check(x) } } catch (e) { log.push(e.message) }
        for (const x of iterable) { if (x === 1) break }
        return log
      `),
    ).toEqual([0, 1, 2, "closed", "at 2", "closed"])
  })

  test("array destructuring closes a custom iterator when a default throws", async () => {
    expect(
      await value(`
        const log = []
        const iterable = { [Symbol.iterator]() {
          return { next: () => ({ done: false, value: undefined }), return: () => { log.push("closed"); return {} } }
        } }
        const fail = () => { throw new Error("default") }
        try { const [a = fail()] = iterable } catch (e) { log.push(e.message) }
        const [b = 1, c = 2] = iterable
        return [log, b, c]
      `),
    ).toEqual([["closed", "default", "closed"], 1, 2])
  })

  test("labels, switch, and per-iteration bindings across program calls", async () => {
    expect(
      await value(`
        const id = (x) => x
        const out = []
        outer: for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            if (id(j) === 1) continue outer
            switch (id(i)) { case id(0): out.push("zero"); break; case 1: out.push("one"); default: out.push("d") }
          }
        }
        const fns = []
        for (let i = 0; i < 3; i++) fns.push(() => id(i))
        return [out, fns.map((f) => f())]
      `),
    ).toEqual([["zero", "one", "d", "d"], [0, 1, 2]])
  })

  test("conversions call program valueOf and toString", async () => {
    expect(
      await value(`
        const v = { valueOf: () => 2, toString: () => "key" }
        const o = { [v]: 1 }
        return [v + 1, \`\${v}\`, o.key, "key" in o, v * v, -v]
      `),
    ).toEqual([3, "key", 1, true, 4, -2])
  })

  test("generators, async functions, and tools run on the machine", async () => {
    expect(
      await value(`
        const log = []
        function* g() { try { yield 1; yield 2 } finally { log.push("done") } }
        const it = g()
        it.next()
        it.return(5)
        const twice = async (x) => (await tools.echo({ value: x })) * 2
        const all = await Promise.all([1, 2, 3].map(twice))
        return [log, [...g()], all]
      `),
    ).toEqual([["done", "done"], [1, 2], [2, 4, 6]])
  })

  test("runaway recursion stops at the same depth with the same location", async () => {
    expect((await error(`const f = (n) => f(n + 1); return f(0)`)).message).toBe(
      "RangeError: Maximum call stack size exceeded (line 1, col 18)",
    )
  })

  test("the machine does not import Effect", async () => {
    const files = await Array.fromAsync(new Glob("src/machine/*.ts").scan({ cwd: `${import.meta.dir}/..` }))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(await Bun.file(`${import.meta.dir}/../${file}`).text()).not.toMatch(/from "effect"/)
    }
  })
})
