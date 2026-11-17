var probe
function f(_ = null) {
  var x = "inside"
  probe = function () { return x }
}
f()
var x = "outside"
return [probe(), x]
