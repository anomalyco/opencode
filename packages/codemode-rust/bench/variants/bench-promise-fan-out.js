async function task(n) {
  await undefined
  return n + n
}
const pending = []
for (let j = 0; j < 5e3; j++) pending.push(task(j))
const settled = await Promise.all(pending)
return settled.length
