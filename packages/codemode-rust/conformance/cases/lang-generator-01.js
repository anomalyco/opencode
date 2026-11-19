const log = []
function* g(a = log.push("param")) { log.push("body"); yield a }
const it = g()
log.push("created")
it.next()
function* bad({ x } = null) { yield x }
async function* asyncBad({ x } = null) { yield x }
let failures = []
try { bad() } catch (error) { failures.push(error.constructor.name) }
try { asyncBad() } catch (error) { failures.push(error.constructor.name) }
return [log, failures]
