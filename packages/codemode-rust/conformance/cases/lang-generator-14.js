const events = []
let resolve
const pending = new Promise((done) => { resolve = done })
async function* generate() { return 1 }
const iterator = generate()
await iterator.next()
const returned = iterator.return(pending).then(() => events.push("returned"))
const later = iterator.next().then(() => events.push("later"))
await Promise.resolve()
const before = events.slice()
resolve(9)
await Promise.all([returned, later])
return [before, events]
