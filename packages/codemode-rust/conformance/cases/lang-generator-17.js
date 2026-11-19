const calls = []
let syncStep = 0
const sync = {
  [Symbol.iterator]: () => sync,
  next(...args) {
    calls.push(["sync", args.length])
    syncStep += 1
    return { value: syncStep, done: syncStep > 1 }
  },
}
let asyncStep = 0
const asynchronous = {
  [Symbol.asyncIterator]: () => asynchronous,
  async next(...args) {
    calls.push(["async", args.length])
    asyncStep += 1
    return { value: asyncStep, done: asyncStep > 1 }
  },
}
for (const item of sync) {}
for await (const item of asynchronous) {}
return calls
