const out = []
const attempt = (f) => {
  try {
    f()
    out.push("ok")
  } catch (e) {
    out.push([e.name, e.message])
  }
}
const a = [1, 2]
attempt(() => (a[1] = a))
const o = {}
attempt(() => (o.self = o))
attempt(() => (o.deep = { list: [{ back: o }] }))
attempt(() => (o["computed"] = [o]))
attempt(() => a.push(a))
attempt(() => a.unshift([a]))
attempt(() => a.splice(0, 0, a))
attempt(() => a.fill(a, 5))
attempt(() => Object.assign(o, { again: o }))
const fn = () => 1
attempt(() => (fn.self = fn))
const m = new Map()
attempt(() => (o.map = m))
attempt(() => (m.back = o))
attempt(() => m.set("x", m))
attempt(() => {
  ;[o.x] = [o]
})
// shared, non-circular references are fine
const shared = { v: 1 }
attempt(() => (o.p = { a: shared, b: shared }))
attempt(() => {
  o.n = o.p
})
return { out, keys: Object.keys(o), len: a.length }
