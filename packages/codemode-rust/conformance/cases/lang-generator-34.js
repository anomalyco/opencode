const events = []
function* binding() {
  try { events.push("b1"); yield 1; events.push("b2"); yield 2; events.push("b3"); yield 3; yield 4 }
  finally { events.push("binding close") }
}
const [first, , third] = binding()
function* assignment() {
  try { yield 5; yield 6; yield 7 }
  finally { events.push("assignment close") }
}
let head, rest
;[head, ...rest] = assignment()
return [first, third, head, rest, events]
