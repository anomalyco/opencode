const out = []
for (const [label, a] of [["one", Object.freeze([1])], ["empty", Object.freeze([])], ["two", Object.freeze([1, 2])], ["sealed1", Object.seal([1])], ["ne1", Object.preventExtensions([1])]]) {
  try { a.reverse(); out.push(label + " ok") } catch (e) { out.push(label + " " + e.message) }
}
try { Object.fromEntries(["ab"]) } catch (e) { out.push(e.constructor.name + ": " + e.message) }
try { Object.fromEntries([null]) } catch (e) { out.push(e.constructor.name + ": " + e.message) }
let steps = 0, closed = 0
const it = { [Symbol.iterator]() { return { next() { steps++; return { value: "x", done: false } }, return() { closed++; return {} } } } }
try { Object.fromEntries(it) } catch (e) { out.push(e.message, steps, closed) }
steps = 0; closed = 0
try { Array.from(it, () => { throw new Error("map") }) } catch (e) { out.push(e.message, steps, closed) }
const src = [127, 4, 8]
out.push(JSON.stringify(Array.from(src, (v, i) => { if (i + 1 < src.length) src[i + 1] = 127; return v })))
const ar = (function () { return arguments })(1, 2)
Object.preventExtensions(ar)
out.push(Object.isFrozen(ar), Object.isSealed(ar), Object.isFrozen(Object.preventExtensions((function () { return arguments })())))
out.push(JSON.stringify(Object.fromEntries([["a", 1], new Map([[0, "k"], [1, "v"]])])))


for (const a of [[3, 5], [5], [[1], 7], [{ length: 2 }, "x"]]) { try { out.push(JSON.stringify(Array.from(...a))) } catch (e) { out.push(e.message) } } try { Object.fromEntries(5) } catch (e) { out.push(e.message) } try { Object.fromEntries([() => 1]) ; out.push("fn ok") } catch (e) { out.push(e.message) } 

for (const a of [[function (a, b) {}], [new Date(0)], [new Error("x")], [Promise.resolve(1)], [{ length: 3, 1: "b" }, (v, i) => v ?? i], [new Map([[1, 2]])], ["héllo", (c) => c.toUpperCase()], [new Set([1, 2]).values()], [null], [undefined], [true], [{ length: -1 }], [{ length: "2" }], [[1, 2], undefined], [[1, 2], (x) => x * 2, null]]) {
  try { out.push(JSON.stringify(Array.from(...a))) } catch (e) { out.push(e.constructor.name + ": " + e.message) }
}
const gg = (function* () { yield 1; yield 2 })()
out.push(JSON.stringify(Array.from(gg, (x) => x + 1)))
out.push(JSON.stringify(Object.fromEntries(new Map([["a", 1], [2, "b"]]))))
try { Object.fromEntries([[{ toString() { return "k" } }, 1]]) } catch (e) { out.push(e.message) }
out.push(JSON.stringify(Object.fromEntries([[{ a: 1 }, 1], [[1, 2], 2], [null, 3], [undefined, 4], [5, 6]])))
return out

