// Object.keys/values/entries/assign/hasOwn, for...in, object spread and object rest take their source as the
// reference's enumerableSource does: null and undefined fail, a promise and a namespace are not data, except that
// Object.keys and for...in list a namespace's names.
const t = (f) => { try { return f() } catch (e) { return [e.name, e.message] } }
const p = Promise.resolve(1)
const forIn = (v) => { const ks = []; for (const k in v) ks.push(k); return ks }
const out = []
for (const v of [null, undefined, p, tools, tools.git, tools.git.status, "ab", 5, true, () => 1]) {
  out.push([
    t(() => Object.keys(v)), t(() => Object.values(v)), t(() => Object.entries(v)),
    t(() => Object.assign({}, v)), t(() => Object.assign(v, { a: 1 }) === v), t(() => Object.hasOwn(v, "length")),
    t(() => forIn(v)), t(() => ({ ...v })), t(() => { const { ...r } = v; return r }),
    t(() => { const { a, ...r } = v; return r }), t(() => Object.getPrototypeOf(v) === null),
    t(() => Object.create(v) !== null),
  ])
}
out.push(t(() => Object.create(null, {})))
return out
