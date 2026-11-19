let done = false
const iterable = {
  plain: true,
  [Symbol.asyncIterator]: () => iterable,
  next: async () => done ? { done: true } : (done = true, { done: false, value: 1 }),
}
const spread = { ...iterable }
const { plain, ...rest } = iterable
const assigned = Object.assign({}, iterable)
const values = []
for await (const item of spread) values.push(item)
return [
  values,
  Object.hasOwn(spread, Symbol.asyncIterator),
  Object.hasOwn(rest, Symbol.asyncIterator),
  Object.hasOwn(assigned, Symbol.asyncIterator),
]
