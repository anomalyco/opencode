let count = 0
const work = async () => {
  for (let i = 0; i < 1000; i++) count = count + 1
  await null
}
work()
return count
