const events = []
function* generate() {
  events.push("start")
  const received = yield 1 + (yield 2)
  return received
}
const iterator = generate()
const before = events.slice()
const first = iterator.next(99)
const second = iterator.next(3)
const third = iterator.next(7)
const fourth = iterator.next(8)
return [before, events, first, second, third, fourth]
