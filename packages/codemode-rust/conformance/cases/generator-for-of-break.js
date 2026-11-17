function* naturals() { let n = 0; while (true) yield n++ }
const out = []
for (const n of naturals()) { if (n > 4) break; out.push(n) }
return out
