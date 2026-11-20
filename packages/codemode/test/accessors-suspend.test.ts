import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Fiber } from "effect"
import { Host, Runtime, toBytes } from "../src/language/index.js"
import { parking } from "../src/language/runtime/driver.js"
import { savedFrames as frames } from "../src/language/snapshot.js"
import { runProgram } from "./run-program.js"

// Suspending and resuming a run at every point a program getter or setter can run or be pending. Each language-level
// case runs once straight through, and once saved to bytes and restored into a fresh runtime at every slice; the
// saved stacks must include the point under test (a getter's frame, the helper running it), and both runs must end
// the same way. Host calls in flight are suspended with `program.suspend()` and resumed with `runtime.resume`, in
// this process and in another one.

/** Runs `code` straight through and with a save and restore at every slice; what the saved stacks held. */
const suspendEverywhere = (code: string) => {
  const plain = runProgram(code)
  const stacks: Array<Array<string>> = []
  const tripped = runProgram(code, {
    roundTrip: { every: 1, max: 100_000 },
    onTrip: (snapshot) => stacks.push(frames(snapshot)),
  })
  expect(tripped).toEqual(plain)
  return {
    result: plain,
    saw: (...names: Array<string>) => stacks.some((stack) => names.every((n) => stack.includes(n))),
  }
}

describe("suspended inside a getter", () => {
  test("entered from a member read, a computed read, destructuring and a method lookup", () => {
    const run = suspendEverywhere(`
      const o = {
        n: 2,
        get member() { let s = 0; for (let i = 0; i < 3; i++) s += this.n; return s },
        get computed() { let s = 0; for (let i = 0; i < 3; i++) s += i; return s },
        get destructured() { let s = 1; for (let i = 0; i < 3; i++) s *= 2; return s },
        get method() { let k = 0; for (let i = 0; i < 3; i++) k++; return () => k },
      }
      const key = "computed"
      const { destructured } = o
      return [o.member, o[key], destructured, o.method()]`)
    expect(run.result).toMatchObject({ ok: true, value: [6, 3, 8, 3] })
    for (const name of ["get member", "get computed", "get destructured", "get method"])
      expect(run.saw(name)).toBe(true)
  })

  test("a getter that throws, caught after a resume", () => {
    const run = suspendEverywhere(`
      const o = { get x() { let s = 0; for (let i = 0; i < 3; i++) s += i; throw new RangeError("at " + s) } }
      try { return o.x } catch (e) { return [e instanceof RangeError, e.message] }`)
    expect(run.result).toMatchObject({ ok: true, value: [true, "at 3"] })
    expect(run.saw("get x")).toBe(true)
  })

  test("a getter that throws, uncaught after a resume", () => {
    const run = suspendEverywhere(`
      const o = { get x() { for (let i = 0; i < 3; i++) {} throw new TypeError("no") } }
      return o.x`)
    expect(run.result).toMatchObject({ ok: false, error: { message: expect.stringContaining("no") } })
    expect(run.saw("get x")).toBe(true)
  })
})

describe("suspended inside a setter", () => {
  test("from =, += and ++", () => {
    const run = suspendEverywhere(`
      const log = []
      const o = {
        v: 1,
        get x() { return this.v },
        set x(v) { for (let i = 0; i < 2; i++) {} log.push(v); this.v = v },
      }
      const a = (o.x = 5)
      o.x += 2
      o.x++
      return [a, o.v, log]`)
    expect(run.result).toMatchObject({ ok: true, value: [5, 8, [5, 7, 8]] })
    expect(run.saw("set x", "$vmSet")).toBe(true)
  })
})

describe("suspended in an iterator-protocol getter (Mode.REDO)", () => {
  const iterable = `
    const log = []
    const make = (n) => ({
      [Symbol.iterator]() {
        let i = 0
        return {
          get next() { for (let k = 0; k < 2; k++) {} return () => ({
            get done() { for (let k = 0; k < 2; k++) {} log.push("done"); return ++i > n },
            get value() { for (let k = 0; k < 2; k++) {} log.push("value"); return i },
          }) },
        }
      },
    })`

  test("for...of, spread and destructuring", () => {
    const run = suspendEverywhere(`${iterable}
      const out = []
      for (const x of make(2)) out.push(x)
      const [first, second] = make(3)
      return [out, [...make(2)], first, second, log.length]`)
    expect(run.result).toMatchObject({ ok: true, value: [[1, 2], [1, 2], 1, 2, 14] })
    expect(run.saw("get done", "$vmRedo (redo)")).toBe(true)
    expect(run.saw("get value", "$vmRedo (redo)")).toBe(true)
    expect(run.saw("get next", "$vmRedo (redo)")).toBe(true)
  })

  test("a getter that throws during for...of", () => {
    const run = suspendEverywhere(`
      const it = { [Symbol.iterator]() { return { next() { return { get done() { for (let k = 0; k < 2; k++) {} throw new Error("bad done") } } } } } }
      try { for (const x of it) {} } catch (e) { return e.message }`)
    expect(run.result).toMatchObject({ ok: true, value: "bad done" })
    expect(run.saw("get done", "$vmRedo (redo)")).toBe(true)
  })
})

describe("suspended mid read-ahead ($vmReplay)", () => {
  test("Array.from, structuredClone and Object.defineProperties with getter descriptors", () => {
    const run = suspendEverywhere(`
      const slow = (v) => { for (let k = 0; k < 2; k++) {} return v }
      const like = { get length() { return slow(2) }, get 0() { return slow("a") }, 1: "b" }
      const clone = structuredClone({ get deep() { return { get v() { return slow(1) } } } })
      const target = Object.defineProperties({}, { x: { get value() { return slow(3) }, get enumerable() { return slow(true) } } })
      return [Array.from(like), clone, target.x, Object.keys(target)]`)
    expect(run.result).toMatchObject({ ok: true, value: [["a", "b"], { deep: { v: 1 } }, 3, ["x"]] })
    for (const name of ["get length", "get 0", "get deep", "get v", "get value", "get enumerable"]) {
      expect(run.saw(name, "$vmReplay")).toBe(true)
    }
  })
})

describe("suspended in the bytecode slow paths", () => {
  test("Object.entries, values, assign (with target setters) and spread", () => {
    const run = suspendEverywhere(`
      const log = []
      const tick = () => { for (let k = 0; k < 2; k++) {} }
      const source = { a: 1, get b() { tick(); return 2 } }
      const target = { set b(v) { tick(); log.push(v) } }
      Object.assign(target, source)
      const { a, ...rest } = source
      return [Object.entries(source), Object.values(source), { ...source }, rest, log]`)
    expect(run.result).toMatchObject({
      ok: true,
      value: [
        [
          ["a", 1],
          ["b", 2],
        ],
        [1, 2],
        { a: 1, b: 2 },
        { b: 2 },
        [2],
      ],
    })
    expect(run.saw("get b", "objectEntries")).toBe(true)
    expect(run.saw("get b", "objectAssign")).toBe(true)
    expect(run.saw("set b", "objectAssign")).toBe(true)
    expect(run.saw("get b", "$vmCopyDataProps")).toBe(true)
  })
})

describe("suspended in the final result's conversion", () => {
  test("getters run as the result is copied out", () => {
    const run = suspendEverywhere(`
      return { a: 1, get b() { for (let k = 0; k < 3; k++) {} return { get c() { for (let k = 0; k < 3; k++) {} return 3 } } } }`)
    expect(run.result).toMatchObject({ ok: true, value: { a: 1, b: { c: 3 } } })
    expect(run.saw("get b", "$vmResult")).toBe(true)
    expect(run.saw("get c", "$vmResult")).toBe(true)
  })
})

/** A latch the test opens by hand. */
const latch = <A = void>() => {
  let resolve!: (value: A) => void
  const promise = new Promise<A>((done) => (resolve = done))
  return { promise, resolve }
}

// A runtime whose `slow` (idempotent, so a suspend may cut it off and a resume calls it again) answers `n * 2` once
// `gate` opens, and whose sync `pick` and `keep` take arguments with promises awaited first.
const hosting = (gate: Promise<void> | undefined) => {
  const started = latch()
  const kept: Array<unknown> = []
  // Its host functions need no services.
  const runtime = Runtime.make({
    translate: { promises: "await" },
    globals: () => ({
      slow: Host.fn(
        ([n]) =>
          Effect.promise(async () => {
            started.resolve()
            await gate
            return (n as number) * 2
          }),
        { type: "async", idempotent: true },
      ),
      pick: Host.fn(([value]) => value),
      keep: Host.fn((args) => void kept.push(args)),
    }),
  }) as Runtime.Runtime<never>
  return { runtime, started: started.promise, kept }
}

// Runs `code` until `slow` is in flight, suspends, and resumes the saved bytes in a fresh runtime; and runs it
// straight through. Both results, and what `keep` got in each.
const suspendInFlight = async (code: string) => {
  const suspended = await suspendParked(code)
  const bytes = toBytes(suspended.state)
  const second = hosting(undefined)
  const resumed = await Effect.runPromise(second.runtime.resume(bytes).run())
  const straight = hosting(undefined)
  const plain = await Effect.runPromise(straight.runtime.execute(code))
  return { resumed, plain, kept: second.kept, keptPlain: straight.kept, state: suspended.state, bytes }
}

// Runs `code` until it is parked waiting on `slow`, and suspends it there; the gate opens after the suspend.
const suspendParked = async (code: string) => {
  const gate = latch()
  const first = hosting(gate.promise)
  const parked = latch()
  parking.onPark = parked.resolve
  const program = first.runtime.program(code, { runId: "r" })
  const fiber = Effect.runFork(program.run())
  await Promise.all([first.started, parked.promise])
  parking.onPark = undefined
  const suspended = await Effect.runPromise(program.suspend())
  // The suspended run's host call settles before any resume.
  gate.resolve()
  await Effect.runPromise(Fiber.join(fiber))
  if (suspended.ok !== "suspended") throw new Error(`expected a suspended run, got ${JSON.stringify(suspended)}`)
  return { state: suspended.state, runtime: first.runtime }
}

describe("suspended while a getter waits on a host call", () => {
  test("a getter waiting on an awaited host argument (a sync call in a getter, under REDO too)", async () => {
    const code = `
      const o = { get x() { return pick(slow(21)) } }
      const it = { [Symbol.iterator]() { let i = 0; return { next() { return { get done() { return i++ > 0 }, get value() { return o.x } } } } } }
      return [[...it], o.x]`
    const run = await suspendInFlight(code)
    expect(run.plain).toMatchObject({ ok: true, value: [[42], 42] })
    expect(run.resumed).toMatchObject({ ok: true, value: [[42], 42] })
    expect(frames(run.state)).toEqual(expect.arrayContaining(["get x", "get value", "$vmRedo (redo)", "$vmHostWait"]))
  })

  test("a getter waiting under REDO itself", async () => {
    const code = `
      const it = { [Symbol.iterator]() { let i = 0; return { next() { return { get done() { return pick(slow(i++)) > 0 }, value: "v" } } } } }
      return [...it]`
    const run = await suspendInFlight(code)
    expect(run.plain).toMatchObject({ ok: true, value: ["v"] })
    expect(run.resumed).toEqual(run.plain)
    expect(frames(run.state)).toEqual(expect.arrayContaining(["get done", "$vmRedo (redo)", "$vmHostWait"]))
  })

  test("a getter read ahead for a host call, waiting on its own host call", async () => {
    const code = `
      const o = { a: 1, get b() { return pick(slow(5)) } }
      keep(o, { get c() { return 3 } })
      return "kept"`
    const run = await suspendInFlight(code)
    expect(run.plain).toMatchObject({ ok: true, value: "kept" })
    expect(run.resumed).toEqual(run.plain)
    expect(run.kept).toEqual([[{ a: 1, b: 10 }, { c: 3 }]])
    expect(run.keptPlain).toEqual(run.kept)
    expect(frames(run.state)).toEqual(expect.arrayContaining(["get b", "$vmReplay", "$vmHostWait"]))
  })

  test("a host call's awaited arguments after its getters ran ($vmHostWait with the read table)", async () => {
    const code = `
      let n = 0
      keep({ p: slow(4), get g() { n++; return "g" } })
      return n`
    const run = await suspendInFlight(code)
    expect(run.plain).toMatchObject({ ok: true, value: 1 })
    expect(run.resumed).toEqual(run.plain)
    expect(run.kept).toEqual([[{ p: 8, g: "g" }]])
    expect(frames(run.state)).toContain("$vmHostWait")
  })

  test("the final result's getter waiting on a host call", async () => {
    const run = await suspendInFlight(`return { get x() { return pick(slow(2)) } }`)
    expect(run.plain).toMatchObject({ ok: true, value: { x: 4 } })
    expect(run.resumed).toEqual(run.plain)
    expect(frames(run.state)).toEqual(expect.arrayContaining(["get x", "$vmResult"]))
  })

  test("a setter waiting on a host call, resumed in another process", async () => {
    const code = `
      const o = { set x(v) { this.got = pick(slow(v)) } }
      o.x = 8
      return o.got`
    const run = await suspendInFlight(code)
    expect(run.plain).toMatchObject({ ok: true, value: 16 })
    expect(run.resumed).toEqual(run.plain)
    expect(frames(run.state)).toEqual(expect.arrayContaining(["set x", "$vmSet"]))
    const file = path.join(tmpdir(), `codemode-getters-${crypto.randomUUID()}.state`)
    await Bun.write(file, run.bytes)
    try {
      const child = Bun.spawn(["bun", path.join(import.meta.dir, "fixtures/resume-getters-process.ts"), file], {
        stdout: "pipe",
        stderr: "inherit",
      })
      const output = await new Response(child.stdout).text()
      expect(await child.exited).toBe(0)
      expect(JSON.parse(output)).toEqual(JSON.parse(JSON.stringify(run.plain)))
    } finally {
      await Bun.file(file).delete()
    }
  })

  test("an iterator's next getter waiting on a host call", async () => {
    const code = `
      const it = { [Symbol.iterator]() { let i = 0; return { get next() { const k = pick(slow(1)); return () => ({ done: i >= 2, value: i++ * k }) } } } }
      const out = []
      for (const x of it) out.push(x)
      return [out, [...it]]`
    const same = await suspendParked(code)
    const again = hosting(undefined)
    expect(await Effect.runPromise(again.runtime.resume(same.state).run())).toMatchObject({
      ok: true,
      value: [
        [0, 2],
        [0, 2],
      ],
    })
    const run = await suspendInFlight(code)
    expect(run.plain).toMatchObject({
      ok: true,
      value: [
        [0, 2],
        [0, 2],
      ],
    })
    expect(run.resumed).toEqual(run.plain)
    expect(frames(run.state)).toEqual(expect.arrayContaining(["get next", "$vmRedo (redo)", "$vmHostWait"]))
  })

  for (const [name, code, value] of [
    [
      "yield*",
      `function* g() { return yield* { [Symbol.iterator]() { let i = 0; return { get next() { const k = pick(slow(1)); return () => ({ done: i >= 2, value: i++ * k }) } } } } } return [...g()]`,
      [0, 2],
    ],
    [
      "for await",
      `const out = []; for await (const x of { [Symbol.asyncIterator]() { let i = 0; return { get next() { const k = pick(slow(1)); return async () => ({ done: i >= 2, value: i++ * k }) } } } }) out.push(x); return out`,
      [0, 2],
    ],
    [
      "destructure",
      `const [a, b] = { [Symbol.iterator]() { let i = 0; return { get next() { const k = pick(slow(1)); return () => ({ done: false, value: ++i * k }) } } } }; return [a, b]`,
      [2, 4],
    ],
    [
      "Array.from",
      `return Array.from({ [Symbol.iterator]() { let i = 0; return { get next() { const k = pick(slow(1)); return () => ({ done: i >= 2, value: i++ * k }) } } } })`,
      [0, 2],
    ],
  ] as const) {
    test(`an iterator's next getter waiting on a host call (${name})`, async () => {
      const run = await suspendInFlight(code)
      expect(run.plain).toMatchObject({ ok: true, value })
      expect(run.resumed).toEqual(run.plain)
    })
  }

  for (const from of ["state", "bytes"] as const) {
    test(`an iterator's next getter waiting on a host call, resumed on the same runtime (${from})`, async () => {
      const code = `
        const it = { [Symbol.iterator]() { let i = 0; return { get next() { const k = pick(slow(1)); return () => ({ done: i >= 2, value: i++ * k }) } } } }
        return [...it]`
      const suspended = await suspendParked(code)
      expect(frames(suspended.state)).toEqual(expect.arrayContaining(["get next", "$vmRedo (redo)", "$vmHostWait"]))
      const resumed = await Effect.runPromise(
        suspended.runtime.resume(from === "state" ? suspended.state : toBytes(suspended.state)).run(),
      )
      expect(resumed).toMatchObject({ ok: true, value: [0, 2] })
    })
  }

  test("a getter inside an iterator op, resumed in another process", async () => {
    const code = `
      const it = { [Symbol.iterator]() { let i = 0; return { get next() { return () => ({ get done() { return pick(slow(i)) > 4 }, value: i++ }) } } } }
      return [...it]`
    const run = await suspendInFlight(code)
    expect(run.plain).toMatchObject({ ok: true, value: [0, 1] })
    expect(run.resumed).toEqual(run.plain)
    expect(frames(run.state)).toEqual(expect.arrayContaining(["get done", "$vmRedo (redo)", "$vmHostWait"]))
    const file = path.join(tmpdir(), `codemode-getters-${crypto.randomUUID()}.state`)
    await Bun.write(file, run.bytes)
    try {
      const child = Bun.spawn(["bun", path.join(import.meta.dir, "fixtures/resume-getters-process.ts"), file], {
        stdout: "pipe",
        stderr: "inherit",
      })
      const output = await new Response(child.stdout).text()
      expect(await child.exited).toBe(0)
      expect(JSON.parse(output)).toEqual(JSON.parse(JSON.stringify(run.plain)))
    } finally {
      await Bun.file(file).delete()
    }
  })
})
