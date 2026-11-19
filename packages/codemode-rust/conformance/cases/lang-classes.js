// Classes (the reference's test/classes.test.ts): declarations and expressions, constructors, methods, accessors,
// fields, inheritance from classes and Error types, super, and how class values show and copy.
const out = []
const run = async (f) => {
  try {
    out.push(await f())
  } catch (e) {
    out.push(["threw", e?.name, e?.message])
  }
}
await run(async () => {
  class A { get1() { return 1 } }
  const B = class { two() { return 2 } }
  const C = class Named { self() { return Named } }
  return [new A().get1(), new B().two(), B.name, C.name, new C().self() === C, typeof A]
})
await run(async () => {
  class Point { constructor(x, y) { this.x = x; this.y = y } }
  const p = new Point(1, 2)
  return [p.x, p.y, p, Point.length, Point.name]
})
await run(async () => {
  class A { constructor() { return { other: true } } } class B { constructor() { this.a = 1; return 5 } } return [new A(), new B()]
})
await run(async () => {
  class Counter {
    constructor(n) { this.n = n }
    inc() { this.n++; return this }
    get_() { return this.n }
    static make(n) { return new Counter(n) }
    static "quoted"() { return this.name }
  }
  return [Counter.make(1).inc().inc().get_(), Counter.quoted(), Counter.prototype.inc.name, Counter.make.name]
})
await run(async () => {
  class A { constructor() { this.a = 1 } m() {} static s() {} }
  const a = new A()
  const keys = []
  for (const k in a) keys.push(k)
  return [Object.keys(a), JSON.stringify(a), keys, Object.keys(A), Object.keys(A.prototype),
    Object.getOwnPropertyDescriptor(A, "prototype").writable, A.prototype.constructor === A]
})
await run(async () => {
  class A {}
  const out = []
  try { A() } catch (e) { out.push(e instanceof TypeError, e.message) }
  try { [1].map(A) } catch (e) { out.push(e instanceof TypeError) }
  try { A.call({}) } catch (e) { out.push(e instanceof TypeError) }
  return out
})
await run(async () => {
  class A {} class B {} const a = new A(); return [a instanceof A, a instanceof B, a instanceof Object, Object.getPrototypeOf(a) === A.prototype]
})
await run(async () => {
  const out = []
  try { new A() } catch (e) { out.push(e instanceof ReferenceError) }
  { try { B } catch (e) { out.push(e instanceof ReferenceError) } class B {} out.push(typeof B) }
  class A {}
  return out
})
await run(async () => {
  class A { m() { try { A = 1 } catch (e) { return e instanceof TypeError } } }
  const m = new A().m()
  A = 2
  return [m, A]
})
await run(async () => {
  class A { constructor(x) { this.x = x } a() { return "a" + this.x } who() { return "A" } }
  class B extends A { constructor(x, y) { super(x); this.y = y } b() { return "b" + this.y } who() { return "B" } }
  class C extends B { constructor() { super(1, 2) } who() { return "C" } }
  const c = new C()
  return [
    c.a(), c.b(), c.who(), c,
    Object.getPrototypeOf(B.prototype) === A.prototype, Object.getPrototypeOf(C) === B, Object.getPrototypeOf(B) === A,
    c.constructor === C, C.name,
  ]
})
await run(async () => {
  class A {}
  class B extends A {}
  class C extends B {}
  const b = new B()
  return [new C() instanceof A, new C() instanceof B, b instanceof C, b instanceof A, new A() instanceof B]
})
await run(async () => {
  const make = (tag) => class { tag() { return tag } }
  class X extends make("t") {}
  const Y = class extends (0, X) { get t() { return this.tag() } }
  return [new X().tag(), new Y().t]
})
await run(async () => {
  class A { constructor(...args) { this.args = args } }
  class B extends A { constructor(a, ...rest) { super(a * 10, ...rest) } }
  class C extends A {}
  return [new B(1, 2, 3).args, new C(4, 5).args, C.length]
})
await run(async () => {
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
  return [b.m(1), b.g, b.stored, b.d(), B.sm(), B.sg]
})
await run(async () => {
  class A {}
  class B extends A { set(v) { super.x = v; return [this.x, Object.keys(this)] } }
  return new B().set(3)
})
await run(async () => {
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
  return new B().m()
})
await run(async () => {
  const C = class { static n = this.name }; return C.n
})
await run(async () => {
  const o = {
    n: 1,
    has(k) { return super.hasOwnProperty.call(this, k) },
    get g() { return super.toString === Object.prototype.toString },
    ["k"]() { return (() => super.hasOwnProperty("n"))() },
  }
  return [o.has("n"), o.has("x"), o.g, o.k()]
})
await run(async () => {
  class A { m() { return "A" + this.n } }
  class B extends A {
    constructor() { const early = () => this.n; super(); this.n = 1; this.early = early() }
    m() { return [1, 2].map((i) => super.m() + i) }
    f = () => super.m()
  }
  const b = new B()
  return [b.m(), b.f(), b.early]
})
await run(async () => {
  const log = []
  class A { a = log.push("A.field"); constructor() { log.push("A.ctor") } }
  class B extends A {
    b = log.push("B.field:" + this.a)
    constructor() { log.push("B.before"); super(); log.push("B.after:" + this.b) }
  }
  class C extends B { c = log.push("C.field") }
  new C()
  return log
})
await run(async () => {
  class A {}
  class Obj extends A { constructor() { super(); return { other: true } } }
  class NoSuper extends A { constructor() { return { early: true } } }
  class Undef extends A { constructor() { super(); return undefined } }
  class Parent { constructor() { return { replaced: 1 } } }
  class Child extends Parent { constructor() { super(); this.mine = 2 } }
  return [new Obj(), new NoSuper(), new Undef() instanceof A, new Child()]
})
await run(async () => {
  class A { static count = 1; static make() { return new this() } static get label() { return "L" + this.name } }
  class B extends A {}
  return [B.count, B.make() instanceof B, B.label, Object.keys(B), B.hasOwnProperty("count")]
})
await run(async () => {
  class A extends AggregateError {}
  const a = new A([1, 2], "agg")
  return [a.errors, a.message, a.name, a instanceof A, a instanceof AggregateError]
})
await run(async () => {
  class A extends TypeError { name = "NotFound" }
  class B extends A { constructor(m, cause) { super(m, { cause }); this.code = 404 } }
  class G extends RangeError { get name() { return "Got" } }
  const b = new B("x", "why")
  return [b instanceof A, b instanceof TypeError, b.name, b.toString(), b.code, b.cause, b.hasOwnProperty("cause"),
    new A("y").hasOwnProperty("cause"), String(new G("z")), new B().message]
})
await run(async () => {
  class E extends Error {}; try { throw new E("m") } catch (e) { return [e instanceof E, e.message] }
})
await run(async () => {
  class E extends Error { name = "E" }; return new E("x")
})
await run(async () => {
  return new Error("x")
})
await run(async () => {
  class E extends Error {}; return [JSON.stringify(new E("x")), JSON.stringify(new Error("x"))]
})
await run(async () => {
  class A { x = 1; get g() { return 2 } m() {} }
  const c = structuredClone(new A())
  return [JSON.stringify(new A()), c, Object.getPrototypeOf(c) === Object.prototype, c instanceof A, typeof c.m]
})
await run(async () => {
  class E extends Error {}
  const e = new E("m")
  return [e instanceof E, e instanceof Error, e instanceof Error, e.message, e.name, String(e), Object.prototype.toString.call(e), Error.isError(e), e.constructor === E]
})
await run(async () => {
  class E extends TypeError {}
  const e = new E("m")
  return [e instanceof E, e instanceof TypeError, e instanceof Error, e.message, e.name, String(e), Object.prototype.toString.call(e), Error.isError(e), e.constructor === E]
})
await run(async () => {
  class E extends RangeError {}
  const e = new E("m")
  return [e instanceof E, e instanceof RangeError, e instanceof Error, e.message, e.name, String(e), Object.prototype.toString.call(e), Error.isError(e), e.constructor === E]
})
await run(async () => {
  class E extends SyntaxError {}
  const e = new E("m")
  return [e instanceof E, e instanceof SyntaxError, e instanceof Error, e.message, e.name, String(e), Object.prototype.toString.call(e), Error.isError(e), e.constructor === E]
})
await run(async () => {
  class E extends ReferenceError {}
  const e = new E("m")
  return [e instanceof E, e instanceof ReferenceError, e instanceof Error, e.message, e.name, String(e), Object.prototype.toString.call(e), Error.isError(e), e.constructor === E]
})
await run(async () => {
  class E extends EvalError {}
  const e = new E("m")
  return [e instanceof E, e instanceof EvalError, e instanceof Error, e.message, e.name, String(e), Object.prototype.toString.call(e), Error.isError(e), e.constructor === E]
})
await run(async () => {
  class E extends URIError {}
  const e = new E("m")
  return [e instanceof E, e instanceof URIError, e instanceof Error, e.message, e.name, String(e), Object.prototype.toString.call(e), Error.isError(e), e.constructor === E]
})
await run(async () => {
  class Box {
    constructor(v) { let s = 0; for (let i = 0; i < 3; i++) s += i; this.v = v + s }
    get_() { let s = 0; for (let i = 0; i < 3; i++) s += i; return this.v + s }
    static of(v) { return new Box(v) }
  }
  const a = Box.of(1)
  const b = new Box(2)
  return [a.get_(), b.get_(), a instanceof Box, Object.getPrototypeOf(a) === Object.getPrototypeOf(b), Object.keys(a)]
})
await run(async () => {
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
  console.log({ a: 1 })
  return 1
})
return out
