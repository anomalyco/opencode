const events = []
Promise.resolve().then(() => events.push("reaction"))
const iterator = {
  [Symbol.iterator]: () => iterator,
  next: () => { throw "next" },
}
try { Array.from(iterator) } catch { events.push("catch") }
await Promise.resolve()
return events
