const out = []
const bad = [3, null, undefined, true, { [Symbol.iterator]: () => 1 }, { [Symbol.iterator]: () => ({ next() { throw new Error("boom") } }) }, { [Symbol.iterator]: 5 }]
for (const name of ["all", "allSettled", "any", "race"]) {
  for (const b of bad) {
    let sync = "returned"
    try { const p = Promise[name](b); out.push(p instanceof Promise); await p.then(() => out.push("resolved"), (e) => out.push(name + ": " + e.constructor.name + ": " + e.message)) } catch (e) { sync = "threw " + e.message }
    if (sync !== "returned") out.push(sync)
  }
}
const log = []
const it = { [Symbol.iterator]() { let i = 0; return { next() { log.push("next" + i); if (i === 2) throw new Error("stop"); return { value: i++, done: false } } } } }
await Promise.all(it).catch((e) => log.push(e.message))
out.push(log.join(","))
return out
