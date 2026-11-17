const events = []
const terminal = {
  [Symbol.iterator]: () => terminal,
  next: () => ({ value: Promise.reject("terminal"), done: true }),
  return: () => { events.push("terminal close"); return {} },
}
let terminalError
try { for await (const item of terminal) {} } catch (error) { terminalError = error }

let returnCount = 0
const returned = {
  [Symbol.iterator]: () => returned,
  next: () => ({ value: 1, done: false }),
  return: () => {
    returnCount += 1
    return { value: Promise.reject("return"), done: false }
  },
}
async function* delegate() { yield* returned }
const iterator = delegate()
await iterator.next()
let returnError
try { await iterator.return("sent") } catch (error) { returnError = error }
return [terminalError, returnError, returnCount, events]
