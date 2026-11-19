const order = []
const promise = Promise.resolve(1)
promise.then(() => order.push("h1"))
promise.then(() => order.push("h2"))
order.push("sync")
await promise
return order
