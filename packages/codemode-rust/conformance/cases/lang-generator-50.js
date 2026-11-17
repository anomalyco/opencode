function* items() { yield Promise.resolve(1); yield Promise.reject("bad"); yield 3 }
const settled = await Promise.allSettled(items())
let all, any
try { await Promise.all(items()) } catch (error) { all = error }
try { await Promise.any((function* () { yield Promise.reject("a"); yield Promise.reject("b") })()) }
catch (error) { any = error.errors }
const race = await Promise.race((function* () { yield 4; yield Promise.resolve(5) })())
return [settled, all, any, race]
