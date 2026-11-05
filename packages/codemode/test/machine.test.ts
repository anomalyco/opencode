import { describe, expect, test } from "bun:test"
import { Glob } from "bun"
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"
import { parseProgram } from "../src/interpreter/execute.js"
import { Interpreter } from "../src/interpreter/interpreter.js"
import { createBuiltins } from "../src/interpreter/intrinsics.js"
import { GeneratorObj, type Native, nativeRule, Obj, PromiseObj, type Value } from "../src/interpreter/objects.js"
import { normal } from "../src/interpreter/signals.js"
import { Frame, type Kind, kinds } from "../src/machine/frame.js"
import { Machine } from "../src/machine/machine.js"
import { type Consumer, consumers } from "../src/machine/native-kind.js"
import { ScopeStack } from "../src/interpreter/scope.js"
import { AsyncFromSyncIterator } from "../src/machine/generators.js"
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

// The value bound to `name` where the program's body is parked, once the machine is stuck.
const programBinding = (machine: Machine, name: string): Value => {
  const slice = [...machine.parked.keys()].find((frames) => frames[0]!.kind.name === "Program")!
  return slice.at(-1)!.scope.get(name, slice[0]!.node!)
}

// Throws unless `value` is plain data: no host function or generator is reachable from it. Program values, scopes,
// AST nodes, and the machine (a back-reference from what settles a promise) are data of their own; frame kinds and
// consumers are module constants named once.
const requireData = (value: unknown, path: string, seen: Set<unknown>): void => {
  if (typeof value === "function") throw new Error(`a host function at ${path}`)
  if (value === null || typeof value !== "object" || seen.has(value)) return
  seen.add(value)
  if (value instanceof Obj || value instanceof ScopeStack || value instanceof Machine) return
  if (ArrayBuffer.isView(value)) return
  const node = value as { type?: unknown; start?: unknown }
  if (typeof node.type === "string" && typeof node.start === "number") return
  if (kinds.get((value as Kind).name) === value || consumers.get((value as Consumer).name) === value) return
  const generator = value as { next?: unknown; throw?: unknown }
  if (typeof generator.next === "function" && typeof generator.throw === "function") {
    throw new Error(`a host generator at ${path}`)
  }
  if (value instanceof Frame) {
    if (kinds.get(value.kind.name) !== value.kind) throw new Error(`an unnamed frame kind at ${path}`)
    return requireData(value.slots, `${path}.${value.kind.name}`, seen)
  }
  const entries = value instanceof Map ? [...value] : Object.entries(value)
  for (const [key, item] of entries) requireData(item, `${path}.${String(key)}`, seen)
}

// Frames as saved state: every one a `Frame` whose state is plain data.
const expectData = (frames: ReadonlyArray<Frame>) => {
  expect(frames.length).toBeGreaterThan(0)
  for (const frame of frames) {
    expect(frame).toBeInstanceOf(Frame)
    requireData(frame, "frame", new Set())
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
        status: "queued",
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
      expectData(frames)
    }
    // Each slice starts at its async boundary: the program's body, or an async function's call.
    expect(slices.map((frames) => frames[0]!.kind.name).sort()).toEqual(["Call", "Call", "Program"])
    expect(machine.depth).toBe(0)
    expect(machine.root.stack).toEqual([])
  })

  test("a suspended generator keeps its body as frames on the generator", () => {
    const machine = machineFor(`
      function* inner() { yield 4 }
      function* g(x) { const log = []; try { log.push(yield x); yield* [2, 3]; yield* inner() } finally { log.push("f") } }
      const fresh = g(0)
      const array = g(1)
      array.next()
      array.next("a")
      const nested = g(1)
      for (let i = 0; i < 4; i++) nested.next()
      await new Promise(() => {})
    `)
    expect(stop(machine).kind).toBe("stuck")
    const generator = (name: string) => {
      const value = programBinding(machine, name)
      if (!(value instanceof GeneratorObj)) throw new Error(`${name} is not a generator`)
      return value
    }
    expect(generator("fresh").state).toBe("suspendedStart")
    expect(generator("fresh").frames.map((frame) => frame.kind.name)).toEqual(["GeneratorBody", "Call"])
    for (const name of ["array", "nested"]) {
      const frames = generator(name).frames
      expect(generator(name).state).toBe("suspendedYield")
      expectData(frames)
      // The slice starts at the generator boundary and ends where `yield*` asked to yield.
      expect(frames[0]!.kind.name).toBe("GeneratorBody")
      expect(frames.map((frame) => frame.kind.name)).toContain("YieldDelegate")
    }
  })

  test("an async generator paused at an await parks its frames as data", () => {
    const machine = machineFor(`
      async function* ag() { const v = await new Promise(() => {}); yield v }
      const it = ag()
      const first = it.next()
      const second = it.next()
      await new Promise(() => {})
    `)
    expect(stop(machine).kind).toBe("stuck")
    const it = programBinding(machine, "it")
    if (!(it instanceof GeneratorObj)) throw new Error("expected a generator")
    expect(it.state).toBe("executing")
    expect(it.queue.length).toBe(2)
    const slices = [...machine.parked.keys()]
    for (const frames of slices) expectData(frames)
    expect(slices.map((frames) => frames[0]!.kind.name).sort()).toEqual(["GeneratorBody", "Program"])
    expect(machine.root.stack).toEqual([])
  })

  test("for await over a synchronous iterable keeps its adapter and reactions as data", () => {
    const machine = machineFor(`
      const never = new Promise(() => {})
      const log = []
      const iterable = { [Symbol.iterator]() { let i = 0; return { next: () => ({ done: false, value: i++ ? never : 1 }) } } }
      for await (const x of iterable) log.push(x)
    `)
    // No native function is made while the program runs: the adapter's methods are intrinsics.
    const made: Array<Native> = []
    nativeRule.observe = (native) => made.push(native)
    try {
      expect(stop(machine).kind).toBe("stuck")
    } finally {
      nativeRule.observe = undefined
    }
    expect(made).toEqual([])
    const never = programBinding(machine, "never")
    if (!(never instanceof PromiseObj)) throw new Error("expected a promise")
    expect(never.reactions.map((reaction) => reaction.kind)).toEqual(["asyncFromSync"])
    const reaction = never.reactions[0]!
    for (const field of Object.values(reaction)) expect(typeof field).not.toBe("function")
    if (reaction.kind !== "asyncFromSync") throw new Error("expected an adapter reaction")
    expect(reaction.done).toBe(false)
    // The iterator it would close on a rejection is the program's own, as a record.
    expect(reaction.close).toMatchObject({ asynchronous: false })
    for (const frames of machine.parked.keys()) expectData(frames)
    const loop = [...machine.parked.keys()].flat().find((frame) => frame.kind.name === "ForOfStatement")!
    const iterator = loop.slots[3] as { iterator: unknown }
    expect(iterator.iterator).toBeInstanceOf(AsyncFromSyncIterator)
  })

  test("the machine does not import Effect", async () => {
    const files = await Array.fromAsync(new Glob("src/machine/*.ts").scan({ cwd: `${import.meta.dir}/..` }))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(await Bun.file(`${import.meta.dir}/../${file}`).text()).not.toMatch(/from "effect"/)
    }
  })
})

describe("built-ins as data", () => {
  test("every frame on every stack is data at every step", async () => {
    const seenKinds = new Set<string>()
    const previous = stats.inspect
    stats.inspect = (stack) => {
      const seen = new Set<unknown>()
      for (const frame of stack) {
        seenKinds.add(frame.kind.name)
        requireData(frame, "frame", seen)
      }
    }
    try {
      const result = await value(`
        const log = []
        const box = (v) => ({ valueOf() { log.push("valueOf"); return v }, toString() { return "box" + v } })
        const xs = Array.from({ length: 6 }, (_, i) => (i * 7) % 6)
        const sorted = xs.map((x) => x * 2).filter((x) => x !== 4).sort((a, b) => b - a)
        const found = [xs.find((x) => x > 3), xs.findLast((x) => x < 3), xs.some((x) => x > 4), xs.every((x) => x >= 0)]
        const flat = xs.flatMap((x) => [x, -x]).reduce((a, b) => a + b, 0) + xs.reduceRight((a, b) => a + b)
        xs.forEach((x) => log.push(x))
        function* gen(n) { for (let i = 0; i < n; i++) yield [String(i), i] }
        const map = new Map(gen(3))
        const set = new Set(Array.from(gen(3), ([k]) => k))
        const weak = new WeakMap([[log, 1]])
        map.forEach((v, k) => log.push(k))
        const setLike = { size: box(2), has: (v) => v === "1", keys: () => ["1", "9"][Symbol.iterator]() }
        const ops = [set.union(setLike).size, set.intersection(setLike).size, set.isSubsetOf(setLike), set.isDisjointFrom(setLike)]
        const groups = [Object.groupBy(xs, (x) => (x % 2 ? box("odd") : "even")), Map.groupBy(xs, (x) => x % 3).size]
        const entries = Object.fromEntries(gen(2))
        const iter = gen(5).map((pair) => pair[1]).filter((n) => n % 2 === 0).flatMap((n) => [n, n]).take(5).drop(1)
        const helpers = [iter.toArray(), gen(4).map(([, n]) => n).reduce((a, b) => a + b), Iterator.from({ next: () => ({ done: true }) }).toArray()]
        const json = JSON.stringify({ a: box(1), d: { toJSON: (k) => "key " + k }, list: [1, undefined] }, (k, v) => (k === "a" ? String(v) : v), 1)
        const parsed = JSON.parse('{"a":[1,2,{"b":3}]}', (k, v) => (typeof v === "number" ? v * 10 : v))
        const text = "a-b-c".replace(/-/g, (m) => "+").replaceAll("+", () => "_") + "x".padStart(box(3), "0")
        const dates = [new Date(box(0)).getTime(), Date.UTC(box(2000), 0), new Date(0).setFullYear(box(1999))]
        const numbers = [Math.max(box(5), 2), Number(box(7)), String(box(1)), [box(1), 2].join(box("|"))]
        const calls = [Math.max.call(null, 1, 2), ((a, b) => a + b).apply(null, [1, 2]), ((a) => a).bind(null, 9)()]
        const params = String(new URLSearchParams(gen(2))) + new Headers([["x", "1"]]).get("x")
        const aggregate = new AggregateError(gen(2), box("many")).errors.length
        const error = new Error(box("boxed")).message
        const work = async (i) => { await null; return i * 2 }
        const all = await Promise.all([work(1), work(2), 3])
        const settled = await Promise.allSettled([work(1), Promise.reject(new Error("no"))])
        const raced = await Promise.race([work(5), new Promise((resolve) => resolve("first"))])
        const any = await Promise.any([Promise.reject(1), work(4)])
        const tried = await Promise.try(() => work(6))
        const thenned = await work(1).then((v) => v + 1).catch(() => 0).finally(() => log.push("finally"))
        const thenable = await { then: (resolve) => resolve("thenable") }
        const tool = await tools.echo({ value: work(10) })
        const found2 = search({ query: "echo" }).items.length
        async function* agen() { yield 1; yield await work(1) }
        const collected = []
        for await (const v of agen()) collected.push(v)
        return { sorted, found, flat, map: map.size, set: set.size, weak: weak.has(log), ops, groups, entries, helpers, json, parsed, text, dates, numbers, calls, params, aggregate, error, all, settled: settled.length, raced, any, tried, thenned, thenable, tool, found2, collected, log: log.length }
      `)
      expect(result).toMatchObject({ all: [2, 4, 3], raced: "first", any: 8, tried: 12, thenned: 3, tool: 20 })
    } finally {
      stats.inspect = previous
    }
    for (const name of [
      "Array callback",
      "Call",
      "Drain",
      "Convert",
      "IteratorHelper.next",
      "JSON.stringify walk",
      "Tool call",
      "Promise combinator",
      "Array sort",
      "PromiseReactionJob",
      "JSON.parse reviver",
      "search",
    ]) {
      expect(seenKinds).toContain(name)
    }
  })
})
