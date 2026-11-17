const events = []
const iterator = {
  [Symbol.iterator]: () => iterator,
  next: () => ({ value: undefined, done: false }),
  return: () => { events.push("close"); throw "close error" },
}
let caught
try {
  const [value = (() => { throw "binding error" })()] = iterator
} catch (error) { caught = error }
return [caught, events]
