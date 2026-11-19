const out = []
for (const x of [1, 2]) out.push(x)
for (const ch of "ab") out.push(ch)
for (const k in { p: 1, q: 2 }) out.push(k)
for (const i in ["x", "y"]) out.push(i)
for (const [k, v] of Object.entries({ m: 3 })) out.push(k + v)
return out
