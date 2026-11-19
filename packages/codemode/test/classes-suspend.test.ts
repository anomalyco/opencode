import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Fiber } from "effect"
import { Host, Runtime, toBytes } from "../src/language/index.js"
import { getInternalPrelude } from "../src/language/internal-prelude.js"
import { compiledPrelude } from "../src/language/prelude/prelude.js"
import type { Snapshot } from "../src/language/snapshot/snapshot.js"

// Suspending a run while a host call is in flight at every point class code runs, and resuming it: from the saved
// state and from bytes in a fresh runtime, in the same runtime, and in another process. Each resumed run must end as
// an uninterrupted one does.

type Saved = { readonly t?: string; readonly f?: ReadonlyArray<unknown>; readonly o?: ReadonlyArray<unknown> }

const frames = (snapshot: Snapshot): Array<string> => {
  const records = snapshot.records as ReadonlyArray<Saved | undefined>
  return records.flatMap((record) => {
    if (record?.t !== "Frame") return []
    const [fn, code] = record.f as [unknown, [string, [string, string, number]], ...Array<unknown>]
    if (Array.isArray(fn) && fn[0] === "r") {
      const props = records[fn[1] as number]!.o!
      return [String(props[props.indexOf("name") + 1])]
    }
    const [, source, index] = code[1]
    const codes = source === "@vm-internal" ? getInternalPrelude().codes : compiledPrelude().codes
    return [codes[index]!.name]
  })
}

const latch = <A = void>() => {
  let resolve!: (value: A) => void
  const promise = new Promise<A>((done) => (resolve = done))
  return { promise, resolve }
}

// Matches test/fixtures/resume-getters-process.ts: `slow` answers `n * 2` once `gate` opens, `pick` its argument.
const hosting = (gate: Promise<void> | undefined) => {
  const started = latch()
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
      keep: Host.fn(() => undefined),
    }),
  }) as Runtime.Runtime<never>
  return { runtime, started: started.promise }
}

// Round-trip mode yields at its checkpoints, so `slow` starting doesn't mean the run is parked on it yet: retry,
// letting it go on longer, until the saved stack reaches `$vmHostWait`.
const suspendParked = async (code: string) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const gate = latch()
    const first = hosting(gate.promise)
    const program = first.runtime.program(code, { runId: "r" })
    const fiber = Effect.runFork(program.run())
    await first.started
    for (let i = 0; i < attempt; i++) await new Promise((done) => setImmediate(done))
    const suspended = await Effect.runPromise(program.suspend())
    gate.resolve()
    await Effect.runPromise(Fiber.join(fiber))
    if (suspended.ok !== "suspended") throw new Error(`expected a suspended run, got ${JSON.stringify(suspended)}`)
    if (frames(suspended.state).includes("$vmHostWait")) return { suspended, runtime: first.runtime }
  }
  throw new Error("the run never parked on $vmHostWait while `slow` was in flight")
}

const cases = [
    [
      "constructor",
      `class A { constructor(n) { this.v = pick(slow(n)) } m() { return this.v + 1 } }
       const a = new A(21)
       return [a.v, a.m(), a instanceof A, Object.keys(a)]`,
      [42, 43, true, ["v"]],
      "A",
    ],
    [
      "field initializer",
      `class A { static scale = 2; a = 1; v = pick(slow(this.a + 20)); w = this.v * A.scale; constructor() { this.after = this.w } }
       const a = new A()
       return [a.v, a.w, a.after, Object.keys(a)]`,
      [42, 84, 84, ["a", "v", "w", "after"]],
      "<instance_members_initializer>",
    ],
    [
      "static field initializer",
      `class A { static v = pick(slow(21)); static w = A.v + 1 }
       return [A.v, A.w]`,
      [42, 43],
      "<static_initializer>",
    ],
    [
      "method",
      `class A { constructor() { this.base = 1 } m(n) { return this.base + pick(slow(n)) } static s() { return new A() } }
       const a = A.s()
       return [a.m(20), a instanceof A]`,
      [41, true],
      "m",
    ],
    [
      "getter",
      `class A { constructor() { this.n = 20 } get v() { return pick(slow(this.n)) + 1 } }
       return [new A().v, Object.keys(A.prototype)]`,
      [41, []],
      "get v",
    ],
    [
      "async method",
      `class A { async load(n) { const v = await pick(slow(n)); return v + 1 } }
       return [await new A().load(21)]`,
      [43],
      "load",
    ],
    [
      "generator method",
      `class A { *items() { yield 1; yield pick(slow(21)); yield 3 } }
       const out = []
       for (const x of new A().items()) out.push(x)
       return out`,
      [1, 42, 3],
      "items",
    ],
    [
      "parent constructor reached through super()",
      `class A { constructor(n) { this.v = pick(slow(n)) } }
       class B extends A { w = this.v + 1; constructor(n) { super(n); this.x = this.w * 2 } }
       class C extends B {}
       const c = new C(21)
       return [c.v, c.w, c.x, c instanceof A, c instanceof C, Object.keys(c)]`,
      [42, 43, 86, true, true, ["v", "w", "x"]],
      "A",
    ],
    [
      "method called through super.method()",
      `class A { m(n) { return this.base + pick(slow(n)) } }
       class B extends A { constructor() { super(); this.base = 1 } m(n) { return super.m(n) * 10 } }
       return [new B().m(20)]`,
      [410],
      "m",
    ],
    [
      "custom error's constructor after super()",
      `class Base extends Error { name = "Base" }
       class NotFound extends Base { constructor(n) { super("missing", { cause: n }); this.code = pick(slow(n)) } }
       try { throw new NotFound(21) } catch (e) {
         return [e instanceof NotFound, e instanceof Error, e.name, e.message, e.cause, e.code, String(e)]
       }`,
      [true, true, "Base", "missing", 21, 42, "Base: missing"],
      "NotFound",
    ],
    [
      "static method",
      `class A { static base = 1; static s(n) { return A.base + pick(slow(n)) } }
       return [A.s(20)]`,
      [41],
      "s",
    ],
    [
      "setter",
      `class A { set v(n) { this.got = pick(slow(n)) } }
       const a = new A()
       a.v = 21
       return [a.got, Object.keys(a)]`,
      [42, ["got"]],
      "set v",
    ],
] as const

const resumeIn = (runtime: Runtime.Runtime<never>, state: Parameters<Runtime.Runtime<never>["resume"]>[0]) =>
  Effect.runPromise(runtime.resume(state).run())

describe("suspended inside a class", () => {
  for (const [name, code, expected, frame] of cases) {
    test(`a host call parked in a ${name}, resumed from state and from bytes in a fresh runtime`, async () => {
      const { suspended } = await suspendParked(code)
      expect(frames(suspended.state)).toEqual(expect.arrayContaining([frame, "$vmHostWait"]))
      const plain = await Effect.runPromise(hosting(undefined).runtime.execute(code))
      expect(plain).toMatchObject({ ok: true, value: expected })
      expect(await resumeIn(hosting(undefined).runtime, suspended.state)).toEqual(plain)
      expect(await resumeIn(hosting(undefined).runtime, toBytes(suspended.state))).toEqual(plain)
    }, 5000)
  }

  for (const name of ["constructor", "parent constructor reached through super()"]) {
    test(`a host call parked in a ${name}, resumed in the same runtime`, async () => {
      const [, code, expected] = cases.find((row) => row[0] === name)!
      const { suspended, runtime } = await suspendParked(code)
      expect(await resumeIn(runtime, toBytes(suspended.state))).toMatchObject({ ok: true, value: expected })
    }, 5000)
  }

  test("instances made before and after a suspend share the prototype, and this before super() still throws", async () => {
    const code = `
      class A { constructor(n) { this.v = n } }
      class B extends A { constructor(early) { if (early) this.x = 1; super(1) } }
      const before = new A(1)
      const v = pick(slow(1))
      const after = new A(v)
      let threw = false
      try { new B(true) } catch (e) { threw = e instanceof ReferenceError }
      return [Object.getPrototypeOf(before) === Object.getPrototypeOf(after), after instanceof A, threw, new B(false).v]`
    const { suspended } = await suspendParked(code)
    expect(await resumeIn(hosting(undefined).runtime, toBytes(suspended.state))).toMatchObject({
      ok: true,
      value: [true, true, true, 1],
    })
  }, 5000)

  test("a host call parked in a custom error's constructor, resumed in another process", async () => {
    const [, code, expected] = cases.find((row) => row[0] === "custom error's constructor after super()")!
    const { suspended } = await suspendParked(code)
    const file = path.join(tmpdir(), `codemode-classes-${crypto.randomUUID()}.state`)
    await Bun.write(file, toBytes(suspended.state))
    try {
      const child = Bun.spawn(["bun", path.join(import.meta.dir, "fixtures/resume-getters-process.ts"), file], {
        stdout: "pipe",
        stderr: "inherit",
      })
      const output = await new Response(child.stdout).text()
      expect(await child.exited).toBe(0)
      expect(JSON.parse(output)).toMatchObject({ ok: true, value: expected })
    } finally {
      await Bun.file(file).delete()
    }
  }, 10000)
})
