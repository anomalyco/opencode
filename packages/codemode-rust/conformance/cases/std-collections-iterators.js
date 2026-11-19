const out = []
const groups = new Map()
groups.getOrInsert("a", []).push(1)
groups.getOrInsert("a", []).push(2)
let calls = 0
const computed = (key) => { calls++; return key + "!" }
out.push([...groups], groups.getOrInsertComputed("b", computed), groups.getOrInsertComputed("b", computed), calls, groups.getOrInsertComputed(-0, (k) => 1 / k === Infinity))
const m = new Map()
out.push(m.getOrInsertComputed("k", () => { m.set("k", "inner"); return "outer" }), m.get("k"))
try { m.getOrInsertComputed("j", 1) } catch (e) { out.push(e.name, e.message) }
try { Map.prototype.get.call(new Set(), 1) } catch (e) { out.push(e.name, e.message) }
try { Set.prototype.add.call(new Map(), 1) } catch (e) { out.push(e.name, e.message) }
const byParity = Object.groupBy([1, 2, 3, 4], (n) => (n % 2 ? "odd" : "even"))
out.push(byParity, Object.getPrototypeOf(byParity), Object.groupBy("abca", (c) => c), [...Map.groupBy([1, 2, 3], (n) => n > 1)], Object.groupBy(new Set([1.5, 2.5]), Math.floor))
for (const f of [() => Object.groupBy(null, (x) => x), () => Map.groupBy([1], 5), () => Object.groupBy(5, (x) => x)]) { try { f() } catch (e) { out.push(e.name) } }
const a = new Set([1, 2, 3]), b = new Set([2, 3, 4])
out.push([...a.union(b)], [...a.intersection(b)], [...a.difference(b)], [...a.symmetricDifference(b)], a.isSubsetOf(b), new Set([2]).isSubsetOf(b), a.isSupersetOf(new Set([1])), a.isDisjointFrom(new Set([9])), [...a.union(new Map([[7, 1]]))])
for (const f of [() => a.union(1), () => a.union({ size: NaN, has() {}, keys() {} }), () => a.union({ size: -1, has() {}, keys() {} }), () => a.union({ size: 1, has: 1, keys() {} })]) { try { f() } catch (e) { out.push([e.name, e.message]) } }
const k1 = {}, k2 = [], wm = new WeakMap([[k1, 1]]), ws = new WeakSet([k2])
out.push(wm.get(k1), wm.has(k2), wm.set(k2, 2) === wm, wm.get(k2), wm.delete(k2), wm.has(k2), wm.get(1), wm.has("x"), wm.delete(null), wm.getOrInsert(k2, 5), wm.getOrInsertComputed({}, () => 6))
out.push(ws.has(k2), ws.has(k1), ws.add(k1) === ws, ws.has(k1), ws.delete(k1), ws.has(k1), ws.has(1), String(wm), Object.prototype.toString.call(ws), JSON.stringify({ wm, ws }), typeof wm.size, wm instanceof WeakMap)
for (const f of [() => wm.set(1, 1), () => ws.add("s"), () => WeakMap(), () => new WeakMap([1]), () => new WeakSet([1]), () => WeakMap.prototype.get.call(new Map(), {}), () => wm.getOrInsert(1, 1)]) { try { f() } catch (e) { out.push([e.name, e.message]) } }
console.log(wm, ws)
const pulled = []
function* naturals() { let n = 0; while (true) { pulled.push(n); yield n++ } }
const squares = naturals().map((n) => n * n).filter((n) => n % 2 === 0).drop(1).take(3)
out.push(squares.next(), squares.toArray(), squares.next(), pulled)
out.push(new Map([["a", 1], ["b", 2]]).values().map((v, i) => v * 10 + i).toArray(), [1, 2].values().flatMap((n) => [n, [n]]).toArray(), [...new Map([[1, 2]]).entries().map(([k, v]) => k + v)])
const log = []
function* g(name) { try { yield 1; yield 2; yield 3 } finally { log.push(name) } }
const seen = []
g("each").forEach((v, i) => seen.push([v, i]))
out.push(seen, g("r").reduce((x, y) => x + y), g("r2").reduce((x, y) => x + y, 10), g("some").some((v) => v === 2), g("every").every((v) => v < 2), g("find").find((v) => v > 1), g("miss").find((v) => v > 5), log)
const throwing = g("throw").map((v) => { if (v === 2) throw new Error("boom"); return v })
throwing.next()
try { throwing.next() } catch (e) { out.push(e.message) }
const returned = g("return").map((v) => v)
returned.next()
out.push(throwing.next(), returned.return(), returned.next(), log)
const unstarted = g("unstarted").take(1)
out.push(unstarted.return(), log.at(-1))
for (const v of g("loop").filter(() => true)) break
out.push(log.at(-1))
const it = [1, 2, 3].values()
out.push(typeof it.return, it.some((v) => v === 2), it.next().value, typeof it.map((x) => x).return)
let n = 0
out.push(Iterator.from(it) === it, Iterator.from("ab").toArray(), Iterator.from([1, 2]).map((v) => v * 2).toArray(), Iterator.from({ next: () => ({ done: n > 1, value: n++ }) }).toArray(), it instanceof Iterator, [1].keys().toString())
for (const f of [() => Iterator(), () => new Iterator(), () => Iterator.from(5), () => [1].values().take(-1), () => [1].values().map(1), () => Iterator.prototype.next.call({})]) { try { f() } catch (e) { out.push([e.name, e.message]) } }
const done = ["a"].entries(); done.next(); done.next(); out.push(done.next())
return out
