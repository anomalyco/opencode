const events = []
function* generate() { events.push("body"); yield 1 }

const returned = generate()
const startReturn = returned.return(7)
const afterReturn = returned.next()

const thrown = generate()
let startThrow
try { thrown.throw("start") } catch (error) { startThrow = error }
const afterThrow = thrown.next()
let completedThrow
try { thrown.throw("completed") } catch (error) { completedThrow = error }

return [startReturn, afterReturn, startThrow, afterThrow, completedThrow, events]
