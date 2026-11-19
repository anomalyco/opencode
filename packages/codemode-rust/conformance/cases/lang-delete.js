// delete: what may be deleted, what refuses, and with which errors.
const attempt = (f) => {
  try {
    return f()
  } catch (error) {
    return String(error)
  }
}
const o = { a: { b: 1 }, c: 2 }
return {
  plain: [delete o.c, "c" in o, delete o.missing],
  optional: [delete o?.a.b, o.a, delete o.x?.y, delete undefined?.a],
  parenthesized: [delete (o.a), "a" in o],
  identifier: attempt(() => {
    let q = 1
    return delete q
  }),
  global: attempt(() => delete NaN),
  other: [delete 1, delete String(1)],
  constants: [attempt(() => delete Math.PI), attempt(() => delete Number.MAX_VALUE), attempt(() => delete Array.prototype)],
  configurable: attempt(() => [delete Math.max, typeof Math.max]),
  frozen: [attempt(() => delete Object.freeze({ a: 1 }).a), attempt(() => delete Object.seal([1])[0])],
  arrayLength: attempt(() => delete [].length),
  strings: [attempt(() => delete "abc".length), attempt(() => delete "abc"[0]), delete "abc"[9], delete "abc".foo],
  primitives: [delete (5).x, attempt(() => delete null.a)],
  bytes: [attempt(() => delete new Uint8Array(2)[0]), delete new Uint8Array(2)[5]],
  functionKeys: (() => {
    function g(a, b) {}
    const before = [g.name, g.length]
    const deleted = [delete g.name, delete g.length]
    return [before, deleted, g.name, g.length, g.hasOwnProperty("length"), "length" in g]
  })(),
  nativeKeys: (() => {
    const f = Math.min
    return [delete f.name, delete f.length, f.name, f.length]
  })(),
  tools: attempt(() => delete tools.echo),
}
