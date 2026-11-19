var __var = "OUT"
const inner = (function () {
  var __var = "IN"
  ;(function () { __var = "INNER_SPACE" })()
  ;(function () { var __var = "INNER_SUN" })()
  return __var
})()
const after = __var
const assigned = (function () {
  __var = "IN"
  ;(function () { __var = "INNERED" })()
  ;(function () { var __var = "INNAGER" })()
  return __var
})()
return [inner, after, assigned, __var]
