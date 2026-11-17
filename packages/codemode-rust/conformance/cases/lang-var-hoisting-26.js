const fact = function inner(n) { return n <= 1 ? 1 : n * inner(n - 1) }
const reassign = function inner() { inner = 5 }
let failure
try { reassign() } catch (error) { failure = error.constructor.name }
return [fact(4), typeof inner, failure]
