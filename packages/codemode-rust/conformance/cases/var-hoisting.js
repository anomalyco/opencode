const before = typeof x
var x = 5
function f() { if (false) { var y = 1 } return y }
return [before, x, f() === undefined]
