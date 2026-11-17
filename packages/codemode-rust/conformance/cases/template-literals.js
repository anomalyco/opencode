const name = "world", n = 3
const nested = `a${`b${n}`}c`
return [`hello ${name}!`, `${n} * 2 = ${n * 2}`, nested, `line1
line2`]
