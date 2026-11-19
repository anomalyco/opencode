function fn() {
  var a = 1
  let caught
  try { throw "stuff3" } catch (a) { caught = a }
  return [caught, a]
}
return fn()
