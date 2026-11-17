const sync = {
  *[Symbol.iterator]() { yield 1; yield 2 },
}
const asynchronous = {
  async *[Symbol.asyncIterator]() { yield 3; yield 4 },
}
const values = []
for (const item of sync) values.push(item)
for await (const item of asynchronous) values.push(item)
return values
