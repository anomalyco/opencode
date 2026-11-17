const log = []
const sum = Promise.try((a, b) => { log.push("ran"); return a + b }, 1, 2)
log.push("after")
let caught
try { await Promise.try(() => { throw new RangeError("boom") }) } catch (e) { caught = e.constructor.name }
return [log, sum instanceof Promise, await sum, caught, await Promise.try(async () => 5), await Promise.try(() => ({ then: (r) => r("thenable") }))]
