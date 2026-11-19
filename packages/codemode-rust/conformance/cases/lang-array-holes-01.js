// Holes from literals, Array(n), delete, length and far writes: reads, `in`, keys, logging and JSON.
const a = [1, , 3]
const b = new Array(3)
b[1] = "x"
const c = [1, 2, 3, 4]
delete c[1]
const d = []
d[3] = 4
const e = [1, 2]
e.length = 4
console.log(a, b, c, d, e)
console.log([1, undefined, null, , 2], { a: [, 1] })
console.log(JSON.stringify([a, b]), String([, 1]), `${[1, ,]}`)
const seen = []
const replaced = JSON.stringify([1, , 3], (k, v) => {
  seen.push(k + ":" + typeof v)
  return v
})
const forIn = []
for (const k in a) forIn.push(k)
const shrunk = [1, 2, 3]
shrunk.length = 1
shrunk.length = 3
return {
  lens: [a.length, b.length, c.length, d.length, e.length, [1, , ].length],
  has: [0 in a, 1 in a, a.hasOwnProperty(1), 1 in shrunk],
  keys: [Object.keys(a), Object.keys(c), Object.entries(d), Object.values(a), forIn],
  spread: [[...a], { ...a }, Object.assign({}, a), [...a.entries()]],
  destructure: (() => {
    const [x, y = "default", z] = a
    return [x, y, z]
  })(),
  text: [String(a), a.join("-"), d.toString(), [null, undefined, , 1].join()],
  replaced,
  seen,
  from: [Array.from(a), Array.from({ length: 2 }), Array.isArray(new Array(3))],
  clone: (() => {
    const copy = structuredClone(a)
    return [1 in copy, copy.length]
  })(),
  apply: ((...xs) => [xs.length, 1 in xs]).apply(null, a),
  bytes: [...Uint8Array.from(a)],
  awaited: await Promise.all([1, , 3]),
  result: [a, b, d],
}
