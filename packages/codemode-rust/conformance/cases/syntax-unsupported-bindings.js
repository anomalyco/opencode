// A class's name is not a binding, nor is a var only a with body declares; using is a const nothing disposes; an
// import below the top level does nothing in the program.
const r = [typeof Map, typeof Point]
var y = 1
if (false) with ({}) { var y = 2; var z = 3 }
r.push(y)
try { z } catch (e) { r.push(e.name) }
{
  using u = { v: 1 }
  await using w = 2
  r.push(u.v, w)
  try { u = 3 } catch (e) { r.push(e.message) }
}
{ import q from "nope" }
r.push(typeof q)
function f() { import q from "fs" }
try { f() } catch (e) { r.push([e.name, e.message]) }
return r
class Map {}
{ class Point {} }
