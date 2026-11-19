let done = false
const asyncIterator = {
  next: async () => done ? { done: true } : (done = true, { done: false, value: "async" }),
}
const syncIterator = { next: () => ({ done: true }) }
const iterable = {
  [Symbol.asyncIterator]: () => asyncIterator,
  [Symbol.iterator]: () => syncIterator,
}
const values = []
for await (const item of iterable) values.push(item)
return values
