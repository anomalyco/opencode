const events = []
const iterator = {
  [Symbol.iterator]: () => iterator,
  next() {
    iterator.return = () => { events.push("new"); return {} }
    return { value: 1, done: false }
  },
  return: () => { events.push("old"); return {} },
}
const [item] = iterator
return [item, events]
