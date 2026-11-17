const events = []
let returned, returnRequest
async function* returnWhileExecuting() {
  returnRequest = returned.return(42).then((result) => events.push(["return", result]))
  yield 1
}
returned = returnWhileExecuting()
const firstReturn = returned.next().then((result) => events.push(["first return", result]))
await Promise.all([firstReturn, returnRequest])

let thrown, throwRequest
async function* throwWhileExecuting() {
  throwRequest = thrown.throw("boom").catch((error) => events.push(["throw", error]))
  yield 2
}
thrown = throwWhileExecuting()
const firstThrow = thrown.next().then((result) => events.push(["first throw", result]))
await Promise.all([firstThrow, throwRequest])

async function* queued() { yield "first"; yield "second" }
const iterator = queued()
const first = iterator.next()
const second = iterator.next()
const third = iterator.next()
await Promise.all([
  third.then(() => events.push("third")),
  second.then(() => events.push("second")),
  first.then(() => events.push("first")),
])
return events
