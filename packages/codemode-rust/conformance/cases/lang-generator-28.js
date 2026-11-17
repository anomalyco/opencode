const asyncValue = Promise.resolve("async")
const asynchronous = {
  [Symbol.asyncIterator]: () => asynchronous,
  next: () => ({ value: asyncValue, done: false }),
}
const syncValue = Promise.resolve("sync")
const synchronous = {
  [Symbol.iterator]: () => synchronous,
  next: () => ({ value: syncValue, done: false }),
}
async function* delegate(value) { yield* value }
const asyncResult = await delegate(asynchronous).next()
const syncResult = await delegate(synchronous).next()
return [asyncResult.value === asyncValue, await asyncResult.value, syncResult]
