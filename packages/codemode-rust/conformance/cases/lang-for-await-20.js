let count = 0
const iterator = {
  [Symbol.asyncIterator]: () => iterator,
  next: async () => ({ done: false, value: 1 }),
  return: null,
}
for await (const item of iterator) {
  count += 1
  break
}
return count
