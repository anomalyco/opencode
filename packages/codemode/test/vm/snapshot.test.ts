import { describe, expect, test } from "bun:test"
import { Effect, Scope } from "effect"
import { CodeMode } from "../../src/index.js"
import { createBuiltins } from "../../src/vm/runtime/intrinsics.js"
import { Interpreter } from "../../src/vm/runtime/interpreter.js"
import { type Snapshot, SnapshotError } from "../../src/vm/snapshot/snapshot.js"
import { ToolRuntime } from "../../src/tool-runtime.js"
import { hashOf } from "../../src/vm/code.js"
import { compileSource } from "../../src/vm/compiler/compile.js"
import { moduleUrl, parseVmSource, runProgram } from "./run.js"
import { buildId } from "../../src/vm/snapshot.js"

// The VM's snapshots: a run saved and restored into a fresh runtime anywhere it slices goes on as if it never stopped.

const programs: Record<string, string> = {
  "closures over per-iteration bindings": `
    const fns = []
    for (let i = 0; i < 5; i++) fns.push(() => i * 2)
    let total = 0
    for (const f of fns) total += f()
    return [fns.map((f) => f()), total]`,
  "recursion several frames deep": `
    function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2) }
    const walk = (node, depth) => node === null ? depth : walk(node.next, depth + 1)
    return [fib(12), walk({ next: { next: { next: null } } }, 0)]`,
  "finally levels, labels and pending returns": `
    const out = []
    function f(x) {
      try {
        try { if (x > 1) return "r" + x; out.push("t" + x) } finally { out.push("inner" + x) }
      } finally {
        out.push("outer" + x)
        for (let i = 0; i < 2; i++) out.push("loop" + i)
      }
      return "n" + x
    }
    outer: for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        try { if (j === 1) continue outer; if (i === 3) break outer } finally { out.push(i + ":" + j) }
      }
    }
    return [f(1), f(2), out]`,
  "a custom iterator in mid-iteration, and destructuring": `
    const log = []
    const it = { i: 0, [Symbol.iterator]() { return this }, next() { this.i++; return { value: this.i, done: this.i > 4 } }, return() { log.push("closed"); return {} } }
    for (const x of it) { log.push(x); if (x === 3) break }
    const [a, b = a * 10, ...rest] = [1, undefined, 3, 4]
    const { p, q: { r = 5 } = {}, ...others } = { p: 1, s: 2, t: 3 }
    return [log, a, b, rest, p, r, others]`,
  "a tagged template keeps its strings object": `
    const seen = new Set()
    const tag = (strings, ...values) => { seen.add(strings); return strings.raw.join("|") + values.join(",") }
    let text = ""
    for (let i = 0; i < 4; i++) text += tag\`a\${i}b\`
    return [text, seen.size]`,
  "prelude callbacks and sorts are interrupted and continue": `
    const xs = Array.from({ length: 30 }, (_, i) => (i * 7) % 30)
    const sorted = [...xs].sort((a, b) => a - b)
    const groups = Object.groupBy(xs, (x) => (x % 3 === 0 ? "three" : "other"))
    const mapped = xs.map((x) => x * 2).filter((x) => x % 4 === 0).reduce((a, b) => a + b, 0)
    return [sorted, groups.three.length, mapped, new Map(xs.map((x) => [x, x])).size]`,
  "JSON with toJSON, replacers and revivers": `
    const value = { a: [1, { b: 2, toJSON() { return { c: 3 } } }], d: new Date(0) }
    const text = JSON.stringify(value, (k, v) => (typeof v === "number" ? v + 1 : v), 2)
    return [text, JSON.parse('{"a":[1,2,{"b":3}]}', (k, v) => (typeof v === "number" ? v * 10 : v))]`,
  "errors keep their types and locations": `
    const caught = []
    for (let i = 0; i < 3; i++) {
      try { if (i === 0) null.x; if (i === 1) undefinedName; if (i === 2) throw new RangeError("r" + i) }
      catch (e) { caught.push(e.name + ": " + e.message) }
    }
    return caught`,
  "implicit conversions run program code": `
    let calls = 0
    const o = { valueOf() { calls++; return 2 }, toString() { calls++; return "k" } }
    const t = {}
    t[o] = 1
    return [o + 1, o * o, \`\${o}\`, t.k, calls, String(o).padStart(3, "-")]`,
  "logs and changed built-ins survive": `
    Array.prototype.extra = function () { return this.length }
    Object.freeze(Math)
    for (let i = 0; i < 3; i++) console.log("line", i)
    return [[1, 2, 3].extra(), Object.isFrozen(Math)]`,
  "the program's result is copied out after a slice in the boundary walk": `
    const rows = []
    for (let i = 0; i < 5; i++) rows.push({ i, toJSON() { return { row: this.i } } })
    return rows`,
}

describe("round trips", () => {
  for (const [name, code] of Object.entries(programs)) {
    test(name, () => {
      const straight = runProgram(code)
      expect(straight.ok).toBe(true)
      let trips = 0
      const tripped = runProgram(code, { roundTrip: { every: 1, max: 1000 }, onTrip: () => trips++ })
      expect(tripped).toEqual(straight)
      expect(trips).toBeGreaterThan(0)
    })
  }

  test("a failing program fails the same way, at the same place", () => {
    const code = `let s = 0\nfor (let i = 0; i < 10; i++) s += i\nconst o = null\nreturn o.missing`
    const straight = runProgram(code)
    expect(straight.ok).toBe(false)
    expect(runProgram(code, { roundTrip: { every: 1 } })).toEqual(straight)
  })
})

/** A runtime the way `execute.ts` makes one, with no tools. */
const runtime = () =>
  new Interpreter<never>({
    tools: ToolRuntime.make(ToolRuntime.prepare<never>({}), undefined, {}),
    builtins: createBuiltins(),
  }) as Interpreter<unknown>

const parse = (code: string) => {
  const parsed = parseVmSource(code)
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed.source
}

const restoreOptions = {
  parse,
  interruption: () => {
    throw new Error("no interruption")
  },
}

/** A snapshot as JSON, to tamper with. */
type Saved = {
  readonly format: number
  readonly header: Snapshot["header"]
  readonly records: Array<{ readonly t: string; readonly f: Array<unknown> }>
}

/** A VM sliced once inside a loop, and its state. */
const sliced = (code = `let n = 0\nfor (let i = 0; i < 10; i++) { try { n += i } finally { n += 0 } }\nreturn n`) => {
  const vm = runtime().vm
  vm.start(parse(code))
  vm.tripEvery = 3
  expect(vm.run().kind).toBe("slice")
  const { snapshot, lost } = vm.capture({ strict: true })
  expect(lost).toEqual([])
  return JSON.parse(JSON.stringify(snapshot)) as Saved
}

const frameOf = (snapshot: ReturnType<typeof sliced>) => snapshot.records.find((record) => record.t === "Frame")!

/** A saved frame's registers, a record of their own. */
const regsOf = (snapshot: ReturnType<typeof sliced>) => {
  const ref = frameOf(snapshot).f[4] as [string, number]
  return (snapshot.records[ref[1]] as unknown as { v: Array<unknown> }).v
}

const refusal = (snapshot: unknown) => {
  try {
    runtime().vm.restore(snapshot, restoreOptions)
  } catch (error) {
    expect(error).toBeInstanceOf(SnapshotError)
    return (error as Error).message
  }
  throw new Error("the snapshot was restored")
}

describe("snapshots", () => {
  test("hold code by source and function index, with the source's bytecode hash, and never bytecode", () => {
    const snapshot = sliced()
    expect(snapshot.format).toBe(2)
    const source = snapshot.header.sources[0]!
    expect(source.id).toBe("main")
    expect(source.bytecode).toBe(hashOf(compileSource(parse(source.code))))
    const frame = frameOf(snapshot)
    expect(frame.f[1]).toEqual(["x", ["code", "main", 0]])
    expect(JSON.stringify(snapshot)).not.toContain('"code":[')
  })

  test("a restored VM runs to the same result", () => {
    const vm = runtime().vm
    vm.restore(sliced(), restoreOptions)
    const stop = vm.run()
    expect(stop).toEqual({ kind: "done", completion: { ok: true, value: 45 } })
  })

  test("capturing changes nothing the run sees", () => {
    const vm = runtime().vm
    vm.start(parse(`let n = 0\nfor (let i = 0; i < 10; i++) n += i\nreturn n`))
    vm.tripEvery = 2
    for (let stop = vm.run(); ; stop = vm.run()) {
      if (stop.kind !== "slice") {
        expect(stop).toEqual({ kind: "done", completion: { ok: true, value: 45 } })
        break
      }
      vm.capture({ strict: true })
    }
  })

  test("the build id is stable", () => {
    expect(buildId()).toBe(buildId())
  })

  test("are refused by another build, or when a source compiles to other bytecode", () => {
    expect(refusal({ ...sliced(), header: { ...sliced().header, build: "0.0.0+0" } })).toContain(
      "another Code Mode build",
    )
    const snapshot = sliced()
    const sources = [{ ...snapshot.header.sources[0]!, bytecode: "0000000000000000" }]
    expect(refusal({ ...snapshot, header: { ...snapshot.header, sources } })).toContain("other bytecode")
  })

  test("check every frame against its code before anything runs", () => {
    const tamper = (change: (frame: Array<unknown>) => void) => {
      const snapshot = sliced()
      change(frameOf(snapshot).f)
      return refusal(snapshot)
    }
    expect(tamper((frame) => (frame[2] = 100_000))).toContain("pc")
    expect(tamper((frame) => (frame[2] = 1.5))).toContain("pc")
    expect(tamper((frame) => (frame[3] = 0))).toContain("stack pointer")
    expect(tamper((frame) => (frame[7] = 99))).toContain("mode")
    expect(tamper((frame) => (frame[1] = ["x", ["code", "main", 99]]))).toContain("unknown external value")
  })

  test("a hole on the operand stack is refused", () => {
    const vm = runtime().vm
    vm.start(
      parse(`function f(a, b) { return a + b }\nlet s = 0\nfor (let i = 0; i < 3; i++) s = s + f(i, 1)\nreturn s`),
    )
    vm.tripEvery = 1
    expect(vm.run().kind).toBe("slice")
    const snapshot = JSON.parse(JSON.stringify(vm.capture({ strict: true }).snapshot))
    const regs = regsOf(snapshot)
    const code = compileSource(parse(snapshot.header.sources[0].code))[0]!
    expect(regs.length).toBeGreaterThan(code.locals)
    regs[regs.length - 1] = ["x", "hole"]
    expect(refusal(snapshot)).toContain("hole")
  })

  test("a finally tag out of range is refused", () => {
    const snapshot = sliced()
    const code = compileSource(parse(snapshot.header.sources[0]!.code))[0]!
    regsOf(snapshot)[code.finallies[code.finallyOffsets[0]!]!] = 50
    expect(refusal(snapshot)).toContain("finally tag")
  })
})

describe("suspend", () => {
  /** Starts a program in a scope of its own. */
  const start = <E>(started: Effect.Effect<CodeMode.Execution, E, Scope.Scope>) =>
    Effect.runPromise(Scope.provide(Scope.makeUnsafe())(started))

  test("a sync program suspended mid-loop resumes where it stopped, in a new runtime", async () => {
    const runtime = CodeMode.make({ tools: {}, engine: "vm" })
    const code = `
      const seen = []
      let n = 0
      for (let i = 0; i < 400_000; i++) { n = (n + i) % 1_000_003; if (i % 100_000 === 0) seen.push(i) }
      return [n, seen]`
    const expected = await Effect.runPromise(runtime.execute(code))
    const running = await start(runtime.start(code))
    await new Promise((done) => setTimeout(done, 5))
    const suspended = await Effect.runPromise(running.suspend)
    if (suspended.ok !== "suspended") throw new Error("the run ended before it could be suspended")
    const resumed = await start(runtime.resume(suspended.state))
    expect(await Effect.runPromise(resumed.result)).toEqual(expected)
  })
})

describe("determinism", () => {
  test("another process compiles the same bytecode and has the same build id", async () => {
    const codes = Object.values(programs)
    const local = { hashes: codes.map((code) => hashOf(compileSource(parse(code)))), build: (runtime(), buildId()) }
    const script = `
      import { hashOf } from ${moduleUrl("../../src/vm/code.js")}
      import { compileSource } from ${moduleUrl("../../src/vm/compiler/compile.js")}
      import { parseVmSource } from ${moduleUrl("run.js")}
      import { buildId } from ${moduleUrl("../../src/vm/snapshot.js")}
      import { createBuiltins } from ${moduleUrl("../../src/vm/runtime/intrinsics.js")}
      import { Interpreter } from ${moduleUrl("../../src/vm/runtime/interpreter.js")}
      import { ToolRuntime } from ${moduleUrl("../../src/tool-runtime.js")}
      new Interpreter({ tools: ToolRuntime.make(ToolRuntime.prepare({}), undefined, {}), builtins: createBuiltins() })
      const codes = ${JSON.stringify(codes)}
      console.log(JSON.stringify({ hashes: codes.map((code) => hashOf(compileSource(parseVmSource(code).source))), build: buildId() }))`
    const child = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "inherit" })
    expect(JSON.parse(await new Response(child.stdout).text())).toEqual(local)
    expect(await child.exited).toBe(0)
  })
})
