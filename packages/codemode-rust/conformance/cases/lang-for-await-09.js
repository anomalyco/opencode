let index = 0
const iterator = {
  [Symbol.asyncIterator]: () => iterator,
  async next() {
    index += 1
    if (index > 3) return { done: true }
    return { done: false, value: index }
  },
}
const values = []
for await (const item of iterator) values.push(item)
return values
