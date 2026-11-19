const events = []
let resolve
const pending = new Promise((done) => { resolve = done })
async function* generate() { return 1 }
const iterator = generate()
const first = iterator.next()
const returned = iterator.return(pending)
const later = first.then(() => iterator.next()).then(() => events.push("later"))
returned.then(() => events.push("returned"))
await first
await Promise.resolve()
const before = events.slice()
resolve(9)
await Promise.all([returned, later])
return [before, events]
