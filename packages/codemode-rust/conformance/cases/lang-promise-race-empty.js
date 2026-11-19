const log = []
const p = Promise.race([])
log.push(typeof p.then)
try {
  await p
} catch (e) {
  log.push([e.name, e.message])
}
function* none() {}
try {
  await Promise.race(none())
} catch (e) {
  log.push(e.message)
}
log.push(await Promise.race([Promise.resolve(1), 2]))
return log
