// What classes refuse (the reference's test/classes.test.ts): calls without new, this before super(), return rules,
// refused heritages, and the class syntax that is not supported.
const out = []
const run = async (f) => {
  try {
    out.push(await f())
  } catch (e) {
    out.push(["threw", e?.name, e?.message])
  }
}
await run(async () => {
  class A { f = Object.freeze(this); g = 1 }; new A()
})
await run(async () => {
  class A {}; class B extends A { constructor() { this.x = 1; super() } }; new B()
})
await run(async () => {
  class A {}; class B extends A { constructor() { const f = () => this; f(); super() } }; new B()
})
await run(async () => {
  class A {}; class B extends A { constructor() {} }; new B()
})
await run(async () => {
  class A {}; class B extends A { constructor() { super(); super() } }; new B()
})
await run(async () => {
  class A {}; class B extends A { constructor() { super(); return 1 } }; new B()
})
await run(async () => {
  class A extends null {}
})
await run(async () => {
  class A extends 1 {}
})
await run(async () => {
  function f() {}; class A extends f {}
})
await run(async () => {
  class A { #x = 1 }
})
await run(async () => {
  class A { #m() {} }
})
await run(async () => {
  class A { static { } }
})
await run(async () => {
  function f() { return new.target }
  return f()
})
await run(async () => {
  function f() {}
  return new f()
})
await run(async () => {
  class A {}
  return A()
})
await run(async () => {
  class A extends Map {}
})
await run(async () => {
  class A {}
  class B extends A { constructor() { this.x = 1; super() } }
  return new B()
})
await run(async () => {
  class A {}
  class B extends A { constructor() { super(); super() } }
  return new B()
})
await run(async () => {
  class A {}
  class B extends A { constructor() { const f = () => super(); f() } }
  return new B()
})
await run(async () => {
  class A {}
  class B extends A { m() { [super.x] = [1] } }
  return new B().m()
})
await run(async () => {
  class A { static ["prototype"]() {} }
})
await run(async () => {
  class A extends Map {}
})
await run(async () => {
  class A extends Set {}
})
await run(async () => {
  class A extends Promise {}
})
await run(async () => {
  class A extends Date {}
})
await run(async () => {
  class A extends RegExp {}
})
await run(async () => {
  class A extends URL {}
})
await run(async () => {
  class A extends Array {}
})
await run(async () => {
  class A extends Object {}
})
return out
