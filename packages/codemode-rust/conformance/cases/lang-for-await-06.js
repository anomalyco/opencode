const reads = []
for await (const item of [Promise.resolve(1), Promise.resolve(2), Promise.resolve(3)]) {
  reads.push(() => item)
}
return reads.map((read) => read())
