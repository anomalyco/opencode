function* inner() {
  const input = yield 1
  return input * 2
}
function* outer() {
  const result = yield* inner()
  return result + 1
}
const iterator = outer()
return [iterator.next(), iterator.next(4)]
