import { describe, expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { Host, Runtime, toBytes } from "../src/language/index.js"
import { getInternalPrelude } from "../src/language/internal-prelude.js"
import { compiledPrelude } from "../src/language/prelude/prelude.js"
import type { Snapshot } from "../src/language/snapshot/snapshot.js"
import { compileSource } from "../src/language/compiler/compile.js"
import { verifyAll } from "./verify-bytecode.js"
import { parseVmSource, runProgram } from "./run-program.js"

const run = (code: string) => {
  const parsed = parseVmSource(code)
  if (parsed.ok) expect(verifyAll(compileSource(parsed.source, { noCache: true }))).toEqual([])
  return runProgram(code)
}

const value = (code: string) => {
  const result = run(code)
  if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`)
  return result.value
}

describe("base classes", () => {
  test("a declaration and an expression", () => {
    expect(
      value(`
        class A { get1() { return 1 } }
        const B = class { two() { return 2 } }
        const C = class Named { self() { return Named } }
        return [new A().get1(), new B().two(), B.name, C.name, new C().self() === C, typeof A]`),
    ).toEqual([1, 2, "B", "Named", true, "function"])
  })

  test("the constructor sets fields on this", () => {
    expect(
      value(`
        class Point { constructor(x, y) { this.x = x; this.y = y } }
        const p = new Point(1, 2)
        return [p.x, p.y, p, Point.length, Point.name]`),
    ).toEqual([1, 2, { x: 1, y: 2 }, 2, "Point"])
  })

  test("a constructor returning an object replaces the instance", () => {
    expect(
      value(
        `class A { constructor() { return { other: true } } } class B { constructor() { this.a = 1; return 5 } } return [new A(), new B()]`,
      ),
    ).toEqual([{ other: true }, { a: 1 }])
  })

  test("instance and static methods", () => {
    expect(
      value(`
        class Counter {
          constructor(n) { this.n = n }
          inc() { this.n++; return this }
          get_() { return this.n }
          static make(n) { return new Counter(n) }
          static "quoted"() { return this.name }
        }
        return [Counter.make(1).inc().inc().get_(), Counter.quoted(), Counter.prototype.inc.name, Counter.make.name]`),
    ).toEqual([3, "Counter", "inc", "make"])
  })

  test("methods are not enumerable", () => {
    expect(
      value(`
        class A { constructor() { this.a = 1 } m() {} static s() {} }
        const a = new A()
        const keys = []
        for (const k in a) keys.push(k)
        return [Object.keys(a), JSON.stringify(a), keys, Object.keys(A), Object.keys(A.prototype),
          Object.getOwnPropertyDescriptor(A, "prototype").writable, A.prototype.constructor === A]`),
    ).toEqual([["a"], '{"a":1}', ["a"], [], [], false, true])
  })

  test("calling a class without new throws a TypeError", () => {
    expect(
      value(`
        class A {}
        const out = []
        try { A() } catch (e) { out.push(e instanceof TypeError, e.message) }
        try { [1].map(A) } catch (e) { out.push(e instanceof TypeError) }
        try { A.call({}) } catch (e) { out.push(e instanceof TypeError) }
        return out`),
    ).toEqual([true, "Class constructor A cannot be invoked without 'new'", true, true])
  })

  test("instanceof", () => {
    expect(
      value(
        `class A {} class B {} const a = new A(); return [a instanceof A, a instanceof B, a instanceof Object, Object.getPrototypeOf(a) === A.prototype]`,
      ),
    ).toEqual([true, false, true, true])
  })

  test("the class binding has a TDZ", () => {
    expect(
      value(`
        const out = []
        try { new A() } catch (e) { out.push(e instanceof ReferenceError) }
        { try { B } catch (e) { out.push(e instanceof ReferenceError) } class B {} out.push(typeof B) }
        class A {}
        return out`),
    ).toEqual([true, true, "function"])
  })

  test("the inner name is immutable and the outer binding is not", () => {
    expect(
      value(`
        class A { m() { try { A = 1 } catch (e) { return e instanceof TypeError } } }
        const m = new A().m()
        A = 2
        return [m, A]`),
    ).toEqual([true, 2])
  })

  test("unsupported class syntax still reports UnsupportedSyntax", () => {
    for (const code of [
      "class A extends Object {}",
      "class A { #x = 1 }",
      "class A { [k] = 1 }",
      "class A { get x() { return 1 } }",
      "class A { [k]() {} }",
    ]) {
      const result = runProgram(code)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe("UnsupportedSyntax")
    }
  })

  test("a class value survives a snapshot round trip", () => {
    const code = `
      class Box {
        constructor(v) { let s = 0; for (let i = 0; i < 3; i++) s += i; this.v = v + s }
        get_() { let s = 0; for (let i = 0; i < 3; i++) s += i; return this.v + s }
        static of(v) { return new Box(v) }
      }
      const a = Box.of(1)
      const b = new Box(2)
      return [a.get_(), b.get_(), a instanceof Box, Object.getPrototypeOf(a) === Object.getPrototypeOf(b), Object.keys(a)]`
    const plain = runProgram(code)
    expect(plain).toMatchObject({ ok: true, value: [7, 8, true, true, ["v"]] })
    expect(runProgram(code, { roundTrip: { every: 1, max: 100_000 } })).toEqual(plain)
    const err = `class A { constructor() { for (let i = 0; i < 3; i++) {} } } try { A() } catch (e) { return e.message }`
    expect(runProgram(err, { roundTrip: { every: 1, max: 100_000 } })).toEqual(runProgram(err))
  })
})

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
    }),
  }) as Runtime.Runtime<never>
  return { runtime, started: started.promise }
}

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
    if (frames(suspended.state).includes("$vmHostWait")) return suspended
  }
  throw new Error("the run never parked on $vmHostWait while `slow` was in flight")
}

describe("class fields", () => {
  test("instance fields with and without initializers", () => {
    expect(
      value(`
        class A { count = 0; x; name = "a" }
        const a = new A()
        return [a.count, a.x === undefined, "x" in a, a.hasOwnProperty("x"), a.name]`),
    ).toEqual([0, true, true, true, "a"])
  })

  test("fields run in order before the constructor body, and without a constructor", () => {
    expect(
      value(`
        const log = []
        class A { a = log.push("a"); constructor() { log.push("ctor:" + this.b) } b = log.push("b") }
        new A()
        class B { c = log.push("c") }
        new B()
        new B()
        return log`),
    ).toEqual(["a", "b", "ctor:2", "c", "c"])
  })

  test("initializers see this, earlier fields and methods", () => {
    expect(
      value(`
        class A {
          base = 2
          doubled = this.base * 2
          viaMethod = this.twice(this.doubled)
          arrow = () => this.base
          fn = function () { return 1 }
          twice(n) { return n * 2 }
        }
        const a = new A()
        return [a.base, a.doubled, a.viaMethod, a.arrow(), a.fn.name, a.arrow.name]`),
    ).toEqual([2, 4, 8, 2, "fn", "arrow"])
  })

  test("each instance gets fresh field values", () => {
    expect(
      value(`
        class A { items = [] }
        const a = new A(), b = new A()
        a.items.push(1)
        return [a.items, b.items]`),
    ).toEqual([[1], []])
  })

  test("static fields, initialized in order after methods, may refer to the class", () => {
    expect(
      value(`
        class A {
          static max = 10
          static double = A.max * 2
          static viaMethod = this.helper()
          static helper() { return A.max + 1 }
          static self = this === A
        }
        return [A.max, A.double, A.viaMethod, A.self, Object.keys(A), "max" in new A()]`),
    ).toEqual([10, 20, 11, true, ["max", "double", "viaMethod", "self"], false])
  })

  test("fields are enumerable own properties", () => {
    expect(
      value(`
        class A { x = 1; y = "two"; m() {} }
        const a = new A()
        a.z = 3
        return [Object.keys(a), JSON.stringify(a)]`),
    ).toEqual([["x", "y", "z"], '{"x":1,"y":"two","z":3}'])
  })

  test("fields are defined, not assigned: a prototype setter is not called", () => {
    expect(
      value(`
        const log = []
        class A { x = 1 }
        Object.defineProperty(A.prototype, "x", { set(v) { log.push(v) }, get() { return "getter" } })
        const a = new A()
        a.x = 2
        return [a.x, log, Object.getOwnPropertyDescriptor(a, "x")]`),
    ).toEqual([2, [], { value: 2, writable: true, enumerable: true, configurable: true }])
  })

  test("private fields are still unsupported", () => {
    const result = run(`class A { #x = 1 }`)
    expect(result.ok).toBe(false)
  })
})

describe("suspended inside a class", () => {
  for (const [name, code, expected, frame] of [
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
  ] as const) {
    test(`a host call parked in a ${name}, resumed in a fresh runtime`, async () => {
      const suspended = await suspendParked(code)
      expect(frames(suspended.state)).toContain(frame)
      const resumed = await Effect.runPromise(hosting(undefined).runtime.resume(toBytes(suspended.state)).run())
      const plain = await Effect.runPromise(hosting(undefined).runtime.execute(code))
      expect(plain).toMatchObject({ ok: true, value: expected })
      expect(resumed).toEqual(plain)
    }, 5000)
  }
})
