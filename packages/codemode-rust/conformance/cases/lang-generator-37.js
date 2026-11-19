function* values() { yield 1; yield Promise.resolve(2); yield 3 }
const array = [...values()]
const args = ((...items) => items)(...values())
return [array[0], array[1] instanceof Promise, await array[1], args[2]]
