const a = await 1
const b = await Promise.resolve(2)
const c = await (async () => 3)()
return a + b + c
