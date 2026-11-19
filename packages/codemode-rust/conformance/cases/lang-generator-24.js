const events = []
function* loopSource() {
  try { yield Promise.reject("loop") } finally { events.push("loop close") }
}
let loopError
try { for await (const item of loopSource()) {} } catch (error) { loopError = error }

function* yieldSource() {
  try { yield Promise.reject("yield") } finally { events.push("yield close") }
}
async function* delegate() { yield* yieldSource() }
let yieldError
try { await delegate().next() } catch (error) { yieldError = error }

const throwing = {
  [Symbol.iterator]: () => throwing,
  next: () => ({ value: 1, done: false }),
  throw: () => ({ value: Promise.reject("throw"), done: false }),
  return: () => { events.push("throw close"); return {} },
}
async function* throwDelegate() { yield* throwing }
const iterator = throwDelegate()
await iterator.next()
let throwError
try { await iterator.throw("sent") } catch (error) { throwError = error }
return [loopError, yieldError, throwError, events]
