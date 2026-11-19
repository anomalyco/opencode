const events = []
const iterator = {
  [Symbol.iterator]: () => iterator,
  next: () => ({ done: true }),
  return: () => { events.push("close"); return {} },
}
try { const [item = (() => { throw "default" })()] = iterator } catch {}
return events
