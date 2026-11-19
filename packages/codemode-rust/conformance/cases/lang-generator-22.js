async function* yielding() {
  try { yield 1 } finally { yield 2 }
}
async function* returning() {
  try { yield 1 } finally { return "override" }
}
async function* throwing() {
  try { yield 1 } finally { throw "override" }
}

const first = yielding()
await first.next()
const finallyYield = await first.return("sent")
const preservedReturn = await first.next()

const second = returning()
await second.next()
const overriddenReturn = await second.return("sent")

const third = throwing()
await third.next()
let overriddenThrow
try { await third.throw("sent") } catch (error) { overriddenThrow = error }
return [finallyYield, preservedReturn, overriddenReturn, overriddenThrow]
