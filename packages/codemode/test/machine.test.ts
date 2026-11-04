import { describe, expect, test } from "bun:test"
import { Glob } from "bun"
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"
import { parseProgram } from "../src/interpreter/execute.js"
import { Interpreter } from "../src/interpreter/interpreter.js"
import { createBuiltins } from "../src/interpreter/intrinsics.js"
import { normal } from "../src/interpreter/signals.js"
import { Frame } from "../src/machine/frame.js"
import type { Machine } from "../src/machine/machine.js"
import { stats } from "../src/machine/task.js"
import { ToolRuntime } from "../src/tool-runtime.js"

// The machine (`src/machine`) runs programs as explicit frames, and keeps the jobs, promises, and host calls they wait
// on as data. The Effect driver only does what the machine's stops ask.

const runtimeTools = {
  echo: Tool.make({
    description: "Echo a value",
    input: Schema.Struct({ value: Schema.Number }),
    output: Schema.Number,
    execute: ({ value }) => Effect.succeed(value),
  }),
}

const runtime = CodeMode.make({ tools: runtimeTools })

const run = (code: string) => Effect.runPromise(runtime.execute(code))

const value = async (code: string) => {
  const before = stats.steps
  const result = await run(code)
  expect(stats.steps).toBeGreaterThan(before)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

const error = async (code: string) => {
  const result = await run(code)
  if (result.ok) throw new Error(`expected failure, got value ${JSON.stringify(result.value)}`)
  return result.error
}

// A machine for `code`, stepped by hand instead of by the Effect driver.
const machineFor = (code: string) => {
  const parsed = parseProgram(code)
  if (!parsed.ok) throw new Error(parsed.error.message)
  const tools = ToolRuntime.make(ToolRuntime.prepare(runtimeTools), undefined, {})
  const ctx = new Interpreter({ tools, builtins: createBuiltins() })
  ctx.start(parsed.source)
  return ctx.machine
}

// The next stop that is not a slice.
const stop = (machine: Machine) => {
  for (;;) {
    const next = machine.run()
    if (next.kind !== "slice") return next
  }
}

describe("machine", () => {
  test("runs programs as frames", async () => {
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
    ).toEqual([
      ["zero", "one", "d", "d"],
      [0, 1, 2],
    ])
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
    ).toEqual([
      ["done", "done"],
      [1, 2],
      [2, 4, 6],
    ])
  })

  test("runaway recursion stops with the location of the call that overflowed", async () => {
    expect((await error(`const f = (n) => f(n + 1); return f(0)`)).message).toBe(
      "RangeError: Maximum call stack size exceeded (line 1, col 18)",
    )
  })

  test("concurrent tool calls stop the machine once, with every call in one batch", () => {
    const machine = machineFor(`return await Promise.all([1, 2, 3].map((value) => tools.echo({ value })))`)
    const started = stop(machine)
    if (started.kind !== "host") throw new Error(`expected a host stop, got ${started.kind}`)
    expect(
      started.calls.map((call) => ({ request: call.request, blocking: call.blocking, status: call.status })),
    ).toEqual(
      [1, 2, 3].map((value) => ({
        request: { kind: "tool", path: ["echo"], args: [{ value }] },
        blocking: false,
        status: "inFlight",
      })),
    )
    // Nothing else can run until host work completes.
    expect(stop(machine)).toEqual({ kind: "host", calls: [] })
    for (const [index, call] of [...started.calls.entries()].reverse())
      machine.complete(call.id, normal((index + 1) * 10))
    expect(stop(machine)).toEqual({ kind: "done", completion: normal([10, 20, 30]) })
    expect(started.calls.map((call) => call.status)).toEqual(["completed", "completed", "completed"])
  })

  test("a blocking host call stops the job that made it until it completes", () => {
    const machine = machineFor(`const found = search({ query: "echo" }); return found.items.length`)
    const started = stop(machine)
    if (started.kind !== "host") throw new Error(`expected a host stop, got ${started.kind}`)
    expect(started.calls.map((call) => [call.request.kind, call.blocking])).toEqual([["search", true]])
    expect(stop(machine)).toEqual({ kind: "host", calls: [] })
    machine.complete(started.calls[0]!.id, normal({ items: [1, 2], remaining: 0, next: null }))
    expect(stop(machine)).toEqual({ kind: "done", completion: normal(2) })
  })

  test("await parks the frames it cuts off the stack as data on the promise", () => {
    const machine = machineFor(`
      const inner = async (x) => { const y = x + 1; return await new Promise(() => {}) }
      const outer = async () => [await inner(1)]
      return await outer()
    `)
    const stuck = stop(machine)
    expect(stuck.kind).toBe("stuck")
    const slices = [...machine.parked.keys()]
    expect(slices.length).toBe(3)
    for (const frames of slices) {
      expect(Array.isArray(frames)).toBe(true)
      for (const frame of frames) {
        expect(frame).toBeInstanceOf(Frame)
        expect(frame.kind.opaque).toBeUndefined()
      }
    }
    // Each slice starts at its async boundary: the program's body, or an async function's call.
    expect(slices.map((frames) => frames[0]!.kind.name).sort()).toEqual(["Call", "Call", "Program"])
    expect(machine.depth).toBe(0)
    expect(machine.root.stack).toEqual([])
  })

  test("the machine does not import Effect", async () => {
    const files = await Array.fromAsync(new Glob("src/machine/*.ts").scan({ cwd: `${import.meta.dir}/..` }))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(await Bun.file(`${import.meta.dir}/../${file}`).text()).not.toMatch(/from "effect"/)
    }
  })
})
