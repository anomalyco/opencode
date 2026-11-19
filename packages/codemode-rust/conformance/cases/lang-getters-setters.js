// Getters and setters in object literals: reads and writes through the chain, `this`, computed keys and names, a
// setter's assignment value, inherited setters on primitives, and how display, JSON, spread and iteration see them.
const log = []
let n = 0
const k = "z"
const base = {
  get x() { log.push("get x"); return ++n },
  set x(v) { log.push("set x " + v); n = v * 10 },
  get [k]() { return this === base ? "base" : "child" },
  set only(v) { log.push("only " + v) },
}
const child = Object.create(base)
const a = base.x
const assigned = (base.x = 5)
child.only = 3
const names = [Object.getOwnPropertyDescriptor(base, "x").get.name, Object.getOwnPropertyDescriptor(base, "z").get.name]
let threw
try { const g = { get r() { return 1 } }; g.r = 2 } catch (e) { threw = e.message }
Object.defineProperty(String.prototype, "shout", { get() { return this.toUpperCase() }, set(v) { log.push("str " + v + this) }, configurable: true })
const shout = "hi".shout
"yo".shout = 1
delete String.prototype.shout
const it = { [Symbol.iterator]() { let i = 0; return { get next() { log.push("next"); return () => ({ get done() { return i++ > 1 }, get value() { return i } }) } } } }
const json = JSON.stringify({ a: 1, get b() { return [n] }, set c(v) {} })
const spread = { ...base }
const { x: destructured, ...rest } = base
console.log(base, { inner: { get q() { return 1 } } })
const thenable = await { get then() { log.push("then"); return (res) => res("adopted") } }
return [a, assigned, n, child.z, base.z, names, threw, shout, [...it], json, Object.keys(spread), destructured, Object.keys(rest), thenable, log]
