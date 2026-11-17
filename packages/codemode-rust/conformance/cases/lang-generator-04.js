function* generate() { yield 1 }
const iterator = generate()
iterator.next()
let suspended
let exhausted
try { iterator.throw("first") } catch (error) { suspended = error }
try { iterator.throw("second") } catch (error) { exhausted = error }
return [suspended, exhausted, iterator.next()]
