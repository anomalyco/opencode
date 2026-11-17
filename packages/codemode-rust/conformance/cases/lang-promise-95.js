let total = 0
const work = async () => {
  await null
  for (let i = 0; i < 1000; i++) total = total + 1
}
await Promise.all([work(), work()])
return total
