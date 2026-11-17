let a = 0
for (let i = 0; i < 5; i++) a += i
let b = 0
while (b < 7) b += 2
let c = 0
do { c++ } while (c < 0)
let d = 0
for (let i = 0; i < 10; i++) { if (i % 2) continue; if (i > 6) break; d += i }
return [a, b, c, d]
