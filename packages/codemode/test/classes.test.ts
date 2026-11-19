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
      "class A { #x = 1 }",
      "class A { #m() {} }",
      "class A { static {} }",
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

describe("accessors, computed names and method kinds", () => {
  test("instance and static getters and setters, not enumerable", () => {
    expect(
      value(`
        class Temp {
          constructor() { this._c = 0 }
          get f() { return this._c * 9 / 5 + 32 }
          set f(v) { this._c = (v - 32) * 5 / 9 }
          static get unit() { return "C:" + this.name }
          static set unit(v) { Temp.last = v }
        }
        const t = new Temp()
        t.f = 212
        Temp.unit = "K"
        const d = Object.getOwnPropertyDescriptor(Temp.prototype, "f")
        const keys = []
        for (const k in t) keys.push(k)
        return [t._c, t.f, Temp.unit, Temp.last, Object.keys(Temp.prototype), keys, d.enumerable,
          d.get.name, d.set.name, typeof Object.getOwnPropertyDescriptor(Temp, "unit").get]`),
    ).toEqual([100, 212, "C:Temp", "K", [], ["_c"], false, "get f", "set f", "function"])
  })

  test("an inherited getter and setter see the instance as this", () => {
    expect(
      value(`
        class A { get double() { return this.n * 2 } set double(v) { this.n = v / 2 } }
        const a = new A()
        a.double = 10
        const child = Object.create(a)
        child.double = 40
        return [a.n, a.double, child.n, child.double, Object.keys(child)]`),
    ).toEqual([5, 10, 20, 40, ["n"]])
  })

  test("computed and symbol names, evaluated once in order", () => {
    expect(
      value(`
        const log = []
        const k = (name) => { log.push(name); return name }
        const sym = Symbol.asyncIterator
        class A {
          [k("m")]() { return "m" }
          static [k("s")]() { return "s" }
          get [k("g")]() { return "g" }
          [k("f")] = log.length;
          [sym]() { return "sym" }
          [1 + 1] = "two"
        }
        log.push("defined")
        const a = new A(), b = new A()
        return [log, a.m(), A.s(), a.g, a.f, b.f, a[sym](), a[2], A.prototype.m.name, A.prototype[sym].name, Object.keys(a)]`),
    ).toEqual([["m", "s", "g", "f", "defined"], "m", "s", "g", 5, 5, "sym", "two", "m", "[Symbol.asyncIterator]", ["2", "f"]])
  })

  test("an iterable class via *[Symbol.iterator], with for...of and spread", () => {
    expect(
      value(`
        class Range {
          constructor(n) { this.n = n }
          *[Symbol.iterator]() { for (let i = 0; i < this.n; i++) yield i }
          static *count() { yield "a"; yield "b" }
          *items() { yield* this }
        }
        const r = new Range(3)
        const seen = []
        for (const x of r) seen.push(x)
        return [seen, [...r], [...Range.count()], [...r.items()], Range.prototype[Symbol.iterator].name]`),
    ).toEqual([[0, 1, 2], [0, 1, 2], ["a", "b"], [0, 1, 2], "[Symbol.iterator]"])
  })

  test("async methods with await", async () => {
    expect(
      await value(`
        class Loader {
          async load(n) { const v = await Promise.resolve(n); return v + 1 }
          static async make() { return (await new Loader().load(1)) * 10 }
        }
        return [await new Loader().load(4), await Loader.make()]`),
    ).toEqual([5, 20])
  })

  test("an async generator method with for await", async () => {
    expect(
      await value(`
        class Feed {
          async *stream() { for (const x of [1, 2, 3]) yield await Promise.resolve(x * 2) }
          async *[Symbol.asyncIterator]() { yield "x" }
        }
        const out = []
        for await (const v of new Feed().stream()) out.push(v)
        for await (const v of new Feed()) out.push(v)
        return out`),
    ).toEqual([2, 4, 6, "x"])
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

const failure = (code: string) => {
  const result = run(code)
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.value)}`)
  const [kind, message] = result.error.message.replace(/ \(line \d+, col \d+\)$/, "").split(/: (.*)/s)
  return [kind, message]
}

describe("class inheritance", () => {
  test("two and three levels: prototype and constructor chains, inherited methods", () => {
    expect(
      value(`
        class A { constructor(x) { this.x = x } a() { return "a" + this.x } who() { return "A" } }
        class B extends A { constructor(x, y) { super(x); this.y = y } b() { return "b" + this.y } who() { return "B" } }
        class C extends B { constructor() { super(1, 2) } who() { return "C" } }
        const c = new C()
        return [
          c.a(), c.b(), c.who(), c,
          Object.getPrototypeOf(B.prototype) === A.prototype, Object.getPrototypeOf(C) === B, Object.getPrototypeOf(B) === A,
          c.constructor === C, C.name,
        ]`),
    ).toEqual(["a1", "b2", "C", { x: 1, y: 2 }, true, true, true, true, "C"])
  })

  test("instanceof across the hierarchy", () => {
    expect(
      value(`
        class A {}
        class B extends A {}
        class C extends B {}
        const b = new B()
        return [new C() instanceof A, new C() instanceof B, b instanceof C, b instanceof A, new A() instanceof B]`),
    ).toEqual([true, true, false, true, false])
  })

  test("any expression evaluating to a class can be extended", () => {
    expect(
      value(`
        const make = (tag) => class { tag() { return tag } }
        class X extends make("t") {}
        const Y = class extends (0, X) { get t() { return this.tag() } }
        return [new X().tag(), new Y().t]`),
    ).toEqual(["t", "t"])
  })

  test("super calls with arguments and spread, and the default derived constructor", () => {
    expect(
      value(`
        class A { constructor(...args) { this.args = args } }
        class B extends A { constructor(a, ...rest) { super(a * 10, ...rest) } }
        class C extends A {}
        return [new B(1, 2, 3).args, new C(4, 5).args, C.length]`),
    ).toEqual([[10, 2, 3], [4, 5], 0])
  })

  test("super.method() and super.x in instance and static methods and accessors", () => {
    expect(
      value(`
        class A {
          m(n) { return "A.m" + n + this.tag }
          get g() { return "A.g" + this.tag }
          set s(v) { this.stored = "A:" + v }
          static sm() { return "A.sm" + this.name }
          static get sg() { return "A.sg" }
        }
        A.prototype.data = "proto-data"
        class B extends A {
          constructor() { super(); this.tag = "!" }
          m(n) { return "B>" + super.m(n) }
          get g() { return "B>" + super.g }
          set s(v) { super.s = v + "+" }
          d() { return super.data + super["m"](2) }
          static sm() { return "B>" + super.sm() }
          static get sg() { return "B>" + super.sg }
        }
        const b = new B()
        b.s = "v"
        return [b.m(1), b.g, b.stored, b.d(), B.sm(), B.sg]`),
    ).toEqual(["B>A.m1!", "B>A.g!", "A:v+", "proto-data" + "A.m2!", "B>A.smB", "B>A.sg"])
  })

  test("super.x = v writes to this when there is no setter", () => {
    expect(
      value(`
        class A {}
        class B extends A { set(v) { super.x = v; return [this.x, Object.keys(this)] } }
        return new B().set(3)`),
    ).toEqual([3, ["x"]])
  })

  test("arrows capture super and this", () => {
    expect(
      value(`
        class A { m() { return "A" + this.n } }
        class B extends A {
          constructor() { const early = () => this.n; super(); this.n = 1; this.early = early() }
          m() { return [1, 2].map((i) => super.m() + i) }
          f = () => super.m()
        }
        const b = new B()
        return [b.m(), b.f(), b.early]`),
    ).toEqual([["A11", "A12"], "A1", 1])
  })

  test("this before super() is a ReferenceError, also through an arrow", () => {
    expect(failure(`class A {}; class B extends A { constructor() { this.x = 1; super() } }; new B()`)).toEqual([
      "ReferenceError",
      "Must call super constructor in derived class before accessing 'this' or returning from derived constructor",
    ])
    expect(failure(`class A {}; class B extends A { constructor() { const f = () => this; f(); super() } }; new B()`)[1]).toBe(
      "Must call super constructor in derived class before accessing 'this' or returning from derived constructor",
    )
    expect(failure(`class A {}; class B extends A { constructor() {} }; new B()`)).toEqual([
      "ReferenceError",
      "Must call super constructor in derived class before accessing 'this' or returning from derived constructor",
    ])
  })

  test("a second super() is a ReferenceError", () => {
    expect(failure(`class A {}; class B extends A { constructor() { super(); super() } }; new B()`)).toEqual([
      "ReferenceError",
      "Super constructor may only be called once",
    ])
  })

  test("derived fields initialize right after super() returns, after the parent's", () => {
    expect(
      value(`
        const log = []
        class A { a = log.push("A.field"); constructor() { log.push("A.ctor") } }
        class B extends A {
          b = log.push("B.field:" + this.a)
          constructor() { log.push("B.before"); super(); log.push("B.after:" + this.b) }
        }
        class C extends B { c = log.push("C.field") }
        new C()
        return log`),
    ).toEqual(["B.before", "A.field", "A.ctor", "B.field:2", "B.after:4", "C.field"])
  })

  test("derived constructor return rules", () => {
    expect(
      value(`
        class A {}
        class Obj extends A { constructor() { super(); return { other: true } } }
        class NoSuper extends A { constructor() { return { early: true } } }
        class Undef extends A { constructor() { super(); return undefined } }
        class Parent { constructor() { return { replaced: 1 } } }
        class Child extends Parent { constructor() { super(); this.mine = 2 } }
        return [new Obj(), new NoSuper(), new Undef() instanceof A, new Child()]`),
    ).toEqual([{ other: true }, { early: true }, true, { replaced: 1, mine: 2 }])
    expect(failure(`class A {}; class B extends A { constructor() { super(); return 1 } }; new B()`)).toEqual([
      "TypeError",
      "Derived constructors may only return object or undefined",
    ])
  })

  test("static inheritance", () => {
    expect(
      value(`
        class A { static count = 1; static make() { return new this() } static get label() { return "L" + this.name } }
        class B extends A {}
        return [B.count, B.make() instanceof B, B.label, Object.keys(B), B.hasOwnProperty("count")]`),
    ).toEqual([1, true, "LB", [], false])
  })

  test("refused heritages", () => {
    expect(failure(`class A extends null {}`)).toEqual(["TypeError", "Classes extending null are not supported."])
    for (const name of ["Array", "Map", "Set", "Promise", "RegExp", "Object", "Uint8Array"]) {
      expect(failure(`class A extends ${name} {}`)).toEqual([
        "TypeError",
        `Extending the built-in ${name} is not supported. Only classes and Error types can be extended.`,
      ])
    }
    expect(failure(`class A extends 1 {}`)[1]).toBe("Class extends value a number is not a constructor or null.")
    expect(failure(`function f() {}; class A extends f {}`)[0]).toBe("TypeError")
    expect(failure(`const o = { m() { return super.x } }; o.m()`)[0]).toBe("SyntaxError")
  })
})
