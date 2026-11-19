const t = (f) => {
  try {
    return f()
  } catch (e) {
    return [e.name, e.message]
  }
}
let p = Promise.resolve(1)
const g = (function* () {})()
const fn = () => 1
return [
  t(() => p == 1),
  t(() => p == p),
  t(() => p != null),
  t(() => p === p),
  t(() => p < 1),
  t(() => p + 1),
  t(() => p * 2),
  t(() => -p),
  t(() => +p),
  t(() => ~p),
  t(() => {
    let q = p
    q++
    return q
  }),
  t(() => {
    let q = p
    q -= 1
    return q
  }),
  t(() => `${p}`),
  t(() => String(p)),
  t(() => typeof p.then),
  t(() => p.foo),
  t(() => p[0]),
  t(() => {
    p.x = 1
  }),
  t(() => {
    const q = Promise.resolve(2)
    q.then = 5
    return typeof q.then
  }),
  t(() => "x" in p),
  t(() => g + 1),
  t(() => fn + ""),
  t(() => tools.echo + 1),
  t(() => {
    for (const k in p) return k
  }),
  t(() => {
    for (const x of { a: 1 }) return x
  }),
  t(() => {
    for (const x of 5) return x
  }),
  t(() => {
    for (const x of fn) return x
  }),
  t(() => {
    const [a] = {}
    return a
  }),
  t(() => [...{}]),
  t(() => Math.max(...{})),
  t(() => [...(function* () { yield* {} })()]),
]
