const numbers = function* (limit) {
  let v = 0
  while (v < limit) {
    yield v
    v++
  }
}
let total = 0
for (const n of numbers(5e4)) total = total + n
return total
