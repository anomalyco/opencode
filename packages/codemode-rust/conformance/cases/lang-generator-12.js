const events = []
async function* generate() {
  events.push("start")
  const input = yield Promise.resolve(1)
  events.push("received " + input)
  return Promise.resolve(3)
}
const iterator = generate()
const first = iterator.next()
const second = iterator.next(2)
const third = iterator.next(4)
const promiseFlags = [first instanceof Promise, second instanceof Promise, third instanceof Promise]
return [promiseFlags, await Promise.all([first, second, third]), events]
