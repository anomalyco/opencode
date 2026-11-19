const events = []
const before = Promise.resolve().then(() => events.push("before"))
for await (const item of [Promise.resolve(1), 2]) events.push("body " + item)
await before
return events
