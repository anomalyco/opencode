function* range(n) { for (let i = 0; i < n; i++) yield i }
let sum = 0
for (const x of range(50000)) sum += x
return sum
