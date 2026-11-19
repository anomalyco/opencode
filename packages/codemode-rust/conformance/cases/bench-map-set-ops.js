const map = new Map()
const set = new Set()
for (let i = 0; i < 30000; i++) { map.set("k" + (i % 5000), i); set.add(i % 7000) }
let sum = 0
for (const [k, v] of map) sum += v
for (const v of set) sum += v
for (let i = 0; i < 5000; i++) { map.delete("k" + i); set.delete(i) }
return sum + map.size + set.size
