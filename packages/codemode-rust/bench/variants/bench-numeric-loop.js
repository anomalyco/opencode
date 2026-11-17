const LIMIT = 3e5
const MODULUS = 0xf4243
let acc = 0
let k = 0
while (k < LIMIT) {
  acc = (acc + 3 * k) % MODULUS
  k += 1
}
return acc
