let count = 0
const result = { done: false, value: 1 }
const iterator = {
  [Symbol.iterator]: () => iterator,
  next() {
    count += 1
    if (count > 1) return { done: true }
    Promise.resolve().then(() => {
      result.done = true
      result.value = 2
    })
    return result
  },
}
const values = []
for await (const item of iterator) values.push(item)
return values
