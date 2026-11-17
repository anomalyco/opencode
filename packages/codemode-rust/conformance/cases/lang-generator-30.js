const calls = []
const make = (symbol, label) => {
  let step = 0
  const iterator = {
    [symbol]: () => iterator,
    next(...args) {
      calls.push([label, "next", args.length, args[0]])
      step += 1
      return { value: step, done: false }
    },
    return(value) {
      calls.push([label, "return", value])
      return { value: value + "!", done: true }
    },
    throw(value) {
      calls.push([label, "throw", value])
      return { value: "caught " + value, done: false }
    },
  }
  return iterator
}
async function* delegate(iterator) { return yield* iterator }
const sync = delegate(make(Symbol.iterator, "sync"))
const asynchronous = delegate(make(Symbol.asyncIterator, "async"))
const results = [await sync.next(9), await sync.next(2), await sync.throw("x"), await sync.return("stop")]
results.push(await asynchronous.next(9), await asynchronous.next(3), await asynchronous.throw("y"))
return [results, calls]
