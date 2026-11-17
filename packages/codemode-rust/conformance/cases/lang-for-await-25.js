const names = []
const invalid = [
  { [Symbol.asyncIterator]: true },
  { [Symbol.asyncIterator]: () => 1 },
  { [Symbol.asyncIterator]: () => ({ next: true }) },
]
for (const iterator of invalid) {
  try {
    for await (const item of iterator) {}
  } catch (error) {
    names.push(error.name)
  }
}
return names
