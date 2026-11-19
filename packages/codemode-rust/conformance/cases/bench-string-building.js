let out = ""
for (let i = 0; i < 50000; i++) out += String.fromCharCode(97 + (i % 26))
const parts = []
for (let i = 0; i < 20000; i++) parts.push(`item-${i}`)
return out.length + parts.join(",").length
