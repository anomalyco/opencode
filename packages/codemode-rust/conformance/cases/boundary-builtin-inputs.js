// Built-ins given a namespace, a promise, a function or a primitive where they expect something else.
const t = (f) => { try { return f() } catch (e) { return [e.name, e.message] } }
const p = Promise.resolve(1)
const out = []
for (const v of [tools, tools.git, tools.git.status, p, () => 1, 5, "ab", null, undefined, new Date(0), /a/, { a: 1 }]) {
  out.push([
    t(() => Array.from(v)), t(() => Object(v) === v), t(() => new Object(v) === v),
    t(() => [Object.isFrozen(v), Object.isSealed(v), Object.isExtensible(v)]),
    t(() => Iterator.from(v).toArray()), t(() => String.raw(v)), t(() => String.fromCodePoint(v)),
    t(() => new Map(v).size), t(() => new Set(v).size), t(() => new WeakSet(v)), t(() => Object.groupBy(v, (x) => x)),
    t(() => new Number(v)), t(() => new String(v)), t(() => new Boolean(v)), t(() => typeof new Promise(v)),
  ])
}
const settled = []
for (const v of [tools.git, p, 5, null, new Date(0), (function* () {})(), []]) {
  for (const f of [Promise.all, Promise.race, Promise.allSettled, Promise.any]) {
    settled.push(await f.call(Promise, v).then((x) => ["ok", x], (e) => [e.name, e.message]))
  }
}
return [out, settled, t(() => String.fromCodePoint(-1)), t(() => String.fromCodePoint(1.5)), t(() => String.fromCodePoint(0x110000))]
