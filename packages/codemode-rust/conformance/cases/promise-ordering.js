const order = []
Promise.resolve().then(() => order.push("micro"))
order.push("sync")
await null
order.push("after")
return order
