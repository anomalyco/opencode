const m = new Map([["a", 1]])
m.set("b", 2).set("a", 3)
const s = new Set([3, 1, 3, 2])
s.add(1).add(4)
const keys = []
m.forEach((v, k) => keys.push(k + v))
return [m.get("a"), m.get("zz"), m.has("b"), m.size, [...m.keys()], [...m.values()], [...m.entries()], [...m], m.delete("a"), m.delete("a"), [...s], s.has(2), s.size, keys]
