const events = []
const throwing = {
  [Symbol.iterator]: () => throwing,
  next() {
    Promise.resolve().then(() => events.push("next reaction"))
    throw "next"
  },
}
try {
  for await (const item of throwing) {}
} catch (error) {
  events.push("next catch")
}

const malformed = {
  [Symbol.iterator]: () => malformed,
  next() {
    Promise.resolve().then(() => events.push("result reaction"))
    return 1
  },
}
try {
  for await (const item of malformed) {}
} catch (error) {
  events.push("result catch")
}

const closing = {
  [Symbol.iterator]: () => closing,
  next: () => ({ done: false, value: 1 }),
  return() {
    Promise.resolve().then(() => events.push("return reaction"))
    throw "return"
  },
}
try {
  for await (const item of closing) break
} catch (error) {
  events.push("return catch")
}
return events
