const log = []
const tick = (n) => Promise.resolve().then(() => log.push(n))
Promise.resolve(1).finally(() => log.push("cleanup")).then((v) => log.push("after " + v))
Promise.reject(2).finally(() => log.push("cleanup 2")).catch((e) => log.push("caught " + e))
Promise.resolve(3).finally(() => Promise.resolve(9)).then((v) => log.push("after " + v))
let p = Promise.resolve()
for (let i = 0; i < 8; i++) p = p.then(() => log.push("tick " + i))
await p
await tick("end")
return log
