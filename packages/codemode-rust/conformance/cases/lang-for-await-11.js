const events = ["pre"]
const ticks = Promise.resolve()
  .then(() => events.push("tick 1"))
  .then(() => events.push("tick 2"))
let done = false
const iterator = {
  [Symbol.asyncIterator]: () => iterator,
  next: () => done ? { done: true } : (done = true, { done: false, value: Promise.resolve(1) }),
}
for await (const item of iterator) events.push(item instanceof Promise ? "loop" : "adopted")
events.push("post")
await ticks
return events
