const run = (iterator, operation) => {
  function* generate() {
    try { yield* iterator } catch (error) { return error.name }
  }
  const value = generate()
  const first = value.next()
  return operation === "next" ? first : value[operation]()
}
const iterable = (fields) => ({ [Symbol.iterator]: () => fields })
const nextResult = run(iterable({ next: () => 1 }), "next")
const throwResult = run(iterable({ next: () => ({ done: false }), throw: () => 1 }), "throw")
const returnResult = run(iterable({ next: () => ({ done: false }), return: () => 1 }), "return")

const badAsync = {
  [Symbol.asyncIterator]: () => ({ next: 1 }),
}
async function* asynchronous() {
  try { yield* badAsync } catch (error) { return error.name }
}
return [nextResult, throwResult, returnResult, await asynchronous().next()]
