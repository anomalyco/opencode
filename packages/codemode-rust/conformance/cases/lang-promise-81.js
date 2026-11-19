const first = Promise.withResolvers()
first.resolve(Promise.resolve("adopted"))
first.resolve("ignored")
const second = Promise.withResolvers()
second.reject(new Error("no"))
let caught
try { await second.promise } catch (e) { caught = e.message }
return [Object.keys(first), first.promise instanceof Promise, await first.promise, caught]
