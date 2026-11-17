const calls = []
let step = 0
const delegate = {
  [Symbol.iterator]: () => delegate,
  next(...args) {
    calls.push(["next", args.length, args[0]])
    step += 1
    return step === 1 ? { value: "one", done: false } : { value: "end", done: true }
  },
  throw(value) {
    calls.push(["throw", value])
    return { value: "recovered", done: false }
  },
  return(value) {
    calls.push(["return", value])
    return { value: value + "!", done: true }
  },
}
function* generate() { return yield* delegate }
const iterator = generate()
const first = iterator.next()
const second = iterator.throw("x")
const third = iterator.return("stop")
return [first, second, third, calls]
