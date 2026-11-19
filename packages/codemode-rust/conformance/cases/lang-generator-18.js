async function* generate() { yield 1; yield await Promise.resolve(2) }
const values = []
for await (const item of generate()) values.push(item)
let name
try { for (const item of generate()) {} } catch (error) { name = error.name }
return [values, name]
