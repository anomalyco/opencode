function f() { return 1 }
const first = f()
function f() { return 2 }
var g = 1
function g() { return 3 }
return [first, f(), typeof g]
