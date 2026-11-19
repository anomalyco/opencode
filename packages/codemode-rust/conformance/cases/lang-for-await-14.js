let count = 0
const next = () => {
  count += 1
  if (count === 1) iterator.next = () => ({ done: true })
  return count > 2 ? { done: true } : { done: false, value: count }
}
const iterator = { [Symbol.iterator]: () => iterator, next }
const values = []
for await (const item of iterator) values.push(item)
return values
