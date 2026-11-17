const events = []
const iterator = {
  [Symbol.iterator]: () => iterator,
  next: () => ({ done: false, value: 1 }),
}
for await (const item of iterator) {
  Promise.resolve().then(() => events.push("reaction"))
  break
}
events.push("after")
return events
