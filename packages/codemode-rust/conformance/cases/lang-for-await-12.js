let index = 0
const iterator = {
  [Symbol.iterator]: () => iterator,
  next() {
    index += 1
    return index > 2 ? { done: true } : { done: false, value: Promise.resolve(index) }
  },
}
const values = []
for await (const item of iterator) values.push(item)
return values
