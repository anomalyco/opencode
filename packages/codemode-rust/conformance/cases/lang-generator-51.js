const events = []
function* items() { events.push("first"); yield 1; events.push("second"); yield 2 }
const promise = Promise.all(items())
events.push("after call")
await promise
return events
