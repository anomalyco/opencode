const events = []
async function* generate() { events.push("body"); yield 1 }

const returned = generate()
const startReturn = await returned.return(Promise.resolve(7))
const afterReturn = await returned.next()

const thrown = generate()
let startThrow
try { await thrown.throw("start") } catch (error) { startThrow = error }
const afterThrow = await thrown.next()
let completedThrow
try { await thrown.throw("completed") } catch (error) { completedThrow = error }

return [startReturn, afterReturn, startThrow, afterThrow, completedThrow, events]
