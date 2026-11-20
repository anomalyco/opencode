import { describe, expect, test } from "bun:test"
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

  test("super.x with ++, --, compound and logical assignment, and delete super.x", () => {
    expect(
      value(`
        class A { get x() { return this._x ?? 1 } set x(v) { this._x = v } }
        class B extends A {
          m() {
            const r = [super.x++, super.x, ++super.x]
            super.x += 10
            super["x"] *= 2
            super.x ||= 5
            super.y ??= 7
            const k = "x"
            r.push(this.x, this.y, super[k]--, this.x)
            try { delete super.x } catch (e) { r.push(e.name) }
            return r
          }
        }
        return new B().m()`),
    ).toEqual([1, 2, 3, 26, 7, 26, 25, "ReferenceError"])
  })

  test("a field cannot be defined on a frozen instance", () => {
    expect(failure(`class A { f = Object.freeze(this); g = 1 }; new A()`)[0]).toBe("TypeError")
  })

  test("an anonymous class has its name before its static fields run", () => {
    expect(value(`const C = class { static n = this.name }; return C.n`)).toBe("C")
  })

  test("super in object literal methods and accessors", () => {
    expect(
      value(`
        const o = {
          n: 1,
          has(k) { return super.hasOwnProperty.call(this, k) },
          get g() { return super.toString === Object.prototype.toString },
          ["k"]() { return (() => super.hasOwnProperty("n"))() },
        }
        return [o.has("n"), o.has("x"), o.g, o.k()]`),
    ).toEqual([true, false, true, true])
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
  })
})

describe("classes extending Error", () => {
  test("every error type can be subclassed", () => {
    for (const name of ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError"]) {
      expect(
        value(`
          class E extends ${name} {}
          const e = new E("m")
          return [e instanceof E, e instanceof ${name}, e instanceof Error, e.message, e.name, String(e),
            Object.prototype.toString.call(e), Error.isError(e), Object.getPrototypeOf(e) === E.prototype]`),
      ).toEqual([true, true, true, "m", name, `${name}: m`, "[object Error]", true, true])
    }
    expect(
      value(`
        class A extends AggregateError {}
        const a = new A([1, 2], "agg")
        return [a.errors, a.message, a.name, a instanceof A, a instanceof AggregateError]`),
    ).toEqual([[1, 2], "agg", "AggregateError", true, true])
  })

  test("multi-level, cause, and name from a field or a getter", () => {
    expect(
      value(`
        class A extends TypeError { name = "NotFound" }
        class B extends A { constructor(m, cause) { super(m, { cause }); this.code = 404 } }
        class G extends RangeError { get name() { return "Got" } }
        const b = new B("x", "why")
        return [b instanceof A, b instanceof TypeError, b.name, b.toString(), b.code, b.cause, b.hasOwnProperty("cause"),
          new A("y").hasOwnProperty("cause"), String(new G("z")), new B().message]`),
    ).toEqual([true, true, "NotFound", "NotFound: x", 404, "why", true, false, "Got: z", ""])
  })

  test("caught, uncaught, returned, logged and stringified like plain errors", () => {
    expect(value(`class E extends Error {}; try { throw new E("m") } catch (e) { return [e instanceof E, e.message] }`)).toEqual([
      true,
      "m",
    ])
    const uncaught = run(`class E extends TypeError { name = "NotFound" }; throw new E("gone")`)
    const plain = run(`throw new TypeError("gone")`)
    expect(uncaught.ok).toBe(false)
    if (uncaught.ok || plain.ok) return
    expect(uncaught.error.kind).toBe(plain.error.kind)
    expect(uncaught.error.message).toBe("NotFound: gone")
    expect(value(`class E extends Error { name = "E" }; return new E("x")`)).toEqual({ name: "E", message: "x" })
    expect(value(`return new Error("x")`)).toEqual({ name: "Error", message: "x" })
    expect(
      value(`class E extends Error {}; return [JSON.stringify(new E("x")), JSON.stringify(new Error("x"))]`),
    ).toEqual(['{"name":"Error","message":"x"}', '{"name":"Error","message":"x"}'])
    expect(runProgram(`class E extends Error { name = "E" }; console.log(new E("hi"))`)).toMatchObject({ logs: ["E: hi"] })
  })
})

describe("showing and copying class values", () => {
  test("console.log shows the class name", () => {
    const code = `
      class Cache { constructor() { this.size = 2 } get g() { return 1 } }
      class Empty {}
      class Lru extends Cache { hits = 0 }
      class E extends Error { name = "E" }
      console.log(new Cache())
      console.log(new Empty())
      console.log(new Lru())
      console.log([new Empty(), { c: new Cache() }])
      console.log(Cache, Lru, class {})
      console.log(new E("bad"))
      console.log({ a: 1 })`
    expect(runProgram(code)).toMatchObject({
      logs: [
        'Cache {"size":2}',
        "Empty {}",
        'Lru {"size":2,"hits":0}',
        '[Empty {},{"c":Cache {"size":2}}]',
        "[class Cache] [class Lru extends Cache] [class (anonymous)]",
        "E: bad",
        '{"a":1}',
      ],
    })
  })

  test("JSON.stringify and structuredClone keep own enumerable fields and drop the prototype", () => {
    expect(
      value(`
        class A { x = 1; get g() { return 2 } m() {} }
        const c = structuredClone(new A())
        return [JSON.stringify(new A()), c, Object.getPrototypeOf(c) === Object.prototype, c instanceof A, typeof c.m]`),
    ).toEqual(['{"x":1}', { x: 1 }, true, false, "undefined"])
  })
})

describe("unsupported features", () => {
  const message = async (code: string) => {
    const result = await run(code)
    if (result.ok) throw new Error("expected an error")
    return result.error.message
  }

  test("private fields", async () => {
    expect(await message("class A { #x = 1 }")).toStartWith("SyntaxError: Private class members (#name) are not supported. Use a regular property instead.")
  })

  test("private methods", async () => {
    expect(await message("class A { #m() {} }")).toStartWith("SyntaxError: Private class members (#name) are not supported. Use a regular property instead.")
  })

  test("#x in o", async () => {
    expect(await message("class A { has(o) { return #x in o } }")).toStartWith("SyntaxError: Private class members (#name) are not supported. Use a regular property instead.")
  })

  test("static blocks", async () => {
    expect(await message("class A { static { } }")).toStartWith("SyntaxError: Class static blocks are not supported. Assign static fields instead.")
  })

  test("new.target", async () => {
    expect(await message("function f() { return new.target }\nreturn f()")).toStartWith("SyntaxError: new.target is not supported.")
  })

  test("decorators", async () => {
    expect(await message("class A { @dec m() {} }")).toStartWith("SyntaxError: Decorators are not supported.")
  })

  test("extends null", async () => {
    expect(await message("class A extends null {}")).toStartWith("TypeError: Classes extending null are not supported.")
  })

  test("new on a plain function", async () => {
    expect(await message("function f() {}\nreturn new f()")).toStartWith("TypeError: f is not a constructor: only classes can be constructed with new. Use a class, or call it as a function that returns an object.")
  })

  test("calling a class", async () => {
    expect(await message("class A {}\nreturn A()")).toStartWith("TypeError: Class constructor A cannot be invoked without 'new'")
  })

  test("extending a built-in", async () => {
    expect(await message("class A extends Map {}")).toStartWith("TypeError: Extending the built-in Map is not supported. Only classes and Error types can be extended.")
  })

  test("this before super()", async () => {
    expect(await message("class A {}\nclass B extends A { constructor() { this.x = 1; super() } }\nreturn new B()")).toStartWith("ReferenceError: Must call super constructor in derived class before accessing 'this' or returning from derived constructor")
  })

  test("super() twice", async () => {
    expect(await message("class A {}\nclass B extends A { constructor() { super(); super() } }\nreturn new B()")).toStartWith("ReferenceError: Super constructor may only be called once")
  })

  test("super() in an arrow", async () => {
    expect(await message("class A {}\nclass B extends A { constructor() { const f = () => super(); f() } }\nreturn new B()")).toStartWith("SyntaxError: super() inside an arrow function is not supported. Call super() directly in the constructor.")
  })

  test("destructuring into super.x", async () => {
    expect(await message("class A {}\nclass B extends A { m() { [super.x] = [1] } }\nreturn new B().m()")).toStartWith("SyntaxError: Destructuring into super.x is not supported.")
  })

  test("a static member named prototype", async () => {
    expect(await message("class A { static [\"prototype\"]() {} }")).toStartWith("TypeError: Classes may not have a static property named 'prototype'.")
  })
})
