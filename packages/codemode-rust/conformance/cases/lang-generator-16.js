const events = []
async function* generate() {
  try {
    yield 1
  } catch (error) {
    events.push("caught " + error)
    yield "recovered"
  } finally {
    events.push("finally")
  }
}
const iterator = generate()
const first = await iterator.next()
const returned = await iterator.return(Promise.reject("bad"))
const beforeNext = events.slice()
const last = await iterator.next()
return [first, returned, beforeNext, last, events]
