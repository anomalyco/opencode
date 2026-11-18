// Prototype methods called on the wrong receiver or with a namespace, a symbol or a primitive where they need
// something else: the reference's checks, in its order.
const t = (f) => { try { const r = f(); return r === undefined ? "undef" : r } catch (e) { return [e.name, e.message] } }
const f = function (a) { return [this === undefined, a] }
const out = []
for (const v of [tools, tools.git, Promise.resolve(1), () => 1, null, undefined, Symbol.iterator, 5, "ab"]) {
  out.push([
    t(() => Number.prototype.toFixed.call(v, 1)), t(() => Number.prototype.valueOf.call(v)),
    t(() => Number.prototype.toLocaleString.call(v)), t(() => new Set([1]).union(v)), t(() => new Set([1]).isSubsetOf(v)),
    t(() => Object.prototype.toLocaleString.call(v)), t(() => Function.prototype.call.call(v, 1)),
    t(() => Function.prototype.bind.call(v, 1)), t(() => f.apply(1, v)), t(() => new Uint8Array(2).set([1], v)),
    t(() => Headers.prototype.set.call(v, 1)), t(() => URLSearchParams.prototype.append.call(v, 1)),
    t(() => Headers.prototype.get.call(v)), t(() => URLSearchParams.prototype.has.call(v)),
  ])
}
out.push(t(() => [1, 2].with(5, 0)), t(() => [1, 2].with(-3, 0)), t(() => (5).toString.call("x")))
return out
