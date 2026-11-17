let done = false
const iterator = {
  [Symbol.asyncIterator]: () => iterator,
  next: async () => done ? { done: true } : (done = true, { done: false, value: Promise.resolve(1) }),
}
for await (const item of iterator) return [item instanceof Promise, await item]
