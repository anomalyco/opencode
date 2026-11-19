const events = []
const acquisition = { [Symbol.iterator]: () => { events.push("acquire"); throw "acquisition" } }
const malformed = {
  [Symbol.iterator]: () => malformed,
  next: () => { events.push("next"); return 1 },
  return: () => { events.push("close"); return {} },
}
for (const source of [acquisition, malformed]) {
  try { Array.from(source) } catch {}
}
return events
