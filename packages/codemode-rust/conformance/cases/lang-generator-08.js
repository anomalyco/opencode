function* generate() { yield* [1, 2] }
const iterator = generate()
iterator.next()
try { iterator.throw("boom") } catch (error) { return error.name }
