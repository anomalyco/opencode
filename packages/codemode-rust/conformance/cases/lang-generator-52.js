const events = []
function* valid() { yield ["a", 1]; yield ["b", 2] }
function* invalid() { try { yield ["a", 1]; yield null; yield ["c", 3] } finally { events.push("close") } }
let name
try { Object.fromEntries(invalid()) } catch (error) { name = error.name }
return [Object.fromEntries(valid()), name, events]
