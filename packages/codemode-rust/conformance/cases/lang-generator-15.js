async function* yielded() { yield Promise.resolve(1) }
async function* returned() { return Promise.resolve(2) }
async function* pending() { yield 0 }
const first = yielded()
const second = returned()
const third = pending()
const exhausted = returned()
await third.next()
await exhausted.next()
return await Promise.all([
  first.next(),
  second.next(),
  third.return(Promise.resolve(3)),
  exhausted.return(Promise.resolve(4)),
])
