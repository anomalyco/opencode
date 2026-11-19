const table = new Map()
const seen = new Set()
let i = 0
while (i < 3e4) {
  table.set(`k${i % 5000}`, i)
  seen.add(i % 7000)
  i++
}
let acc = 0
table.forEach(function (value) {
  acc += value
})
seen.forEach((value) => {
  acc += value
})
for (let j = 5000; j > 0; j--) {
  table.delete("k" + (j - 1))
  seen.delete(j - 1)
}
return acc + table.size + seen.size
