// An accessor in an object literal is defined in order with the properties around it.
let evaluated = 0
const make = () => ({ a: evaluated++, get b() { return 1 }, c: evaluated++ })
let error
try {
  make()
} catch (e) {
  error = String(e)
}
const unused = () => ({ set x(v) {} })
return [error, evaluated, typeof unused]
