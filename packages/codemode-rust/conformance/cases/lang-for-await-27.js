const iterator = {
  [Symbol.asyncIterator]: () => iterator,
  next: async () => 1,
}
for await (const item of iterator) {}
