let returns = 0
const synchronous = {
  [Symbol.iterator]: () => synchronous,
  next: () => ({ value: "next", done: false }),
  return(value) {
    returns += 1
    return { value: returns === 1 ? "return pending" : value, done: returns > 1 }
  },
}
let throws = 0
const asynchronous = {
  [Symbol.asyncIterator]: () => asynchronous,
  next: () => ({ value: "next", done: false }),
  throw(value) {
    throws += 1
    return { value: throws === 1 ? "throw pending" : value, done: throws > 1 }
  },
}
async function* delegate(iterator) { return yield* iterator }
const returned = delegate(synchronous)
const thrown = delegate(asynchronous)
return [
  await returned.next(),
  await returned.return("first"),
  await returned.return("second"),
  await thrown.next(),
  await thrown.throw("first"),
  await thrown.throw("second"),
]
