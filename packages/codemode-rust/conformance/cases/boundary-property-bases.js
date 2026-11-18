// Member writes, deletes, `in` and instanceof on values that are not data objects: null and undefined, primitives,
// a symbol, a promise, a namespace and functions.
const t = (f) => { try { return f() } catch (e) { return [e.name, e.message] } }
const p = Promise.resolve(1)
const sym = Symbol.iterator
const out = []
for (const v of [null, undefined, "ab", 5, true, sym, p, tools, tools.git, () => 1]) {
  out.push([
    t(() => { v.a = 1; return 1 }), t(() => { v["b"] = 2; return 2 }), t(() => delete v.c),
    t(() => "a" in v), t(() => v in {}), t(() => v instanceof Object), t(() => ({}) instanceof v),
    t(() => v.d), t(() => v?.e),
  ])
}
const k = { toString() { out.push("converted"); return "a" } }
out.push(t(() => k in 5), t(() => k in { a: 1 }), t(() => "then" in p), t(() => p in { "[object Promise]": 1 }))
out.push(t(() => { const o = { [p]: 1, [tools.git]: 2 }; return Object.keys(o) }))
out.push(t(() => Object.assign(p, { a: 1 }).a))
return out
