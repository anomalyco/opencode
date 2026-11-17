function* generate() { yield 1; yield 2 }
const iterator = generate()
const symbols = [iterator[Symbol.iterator]() === iterator, iterator[Symbol.asyncIterator]]
const values = []
for (const item of iterator) values.push(item)
return [symbols, values]
