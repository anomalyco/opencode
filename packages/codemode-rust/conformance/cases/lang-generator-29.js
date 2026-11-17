const result = { value: Promise.resolve(1), done: false }
result.value.then(() => { result.done = true })
const source = {
  [Symbol.iterator]: () => source,
  next: () => result,
}
async function* delegate() { yield* source }
return await delegate().next()
