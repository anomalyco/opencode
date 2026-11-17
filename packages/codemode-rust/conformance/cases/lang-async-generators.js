const log = []

async function* numbers(n) {
  try {
    for (let i = 0; i < n; i++) {
      const sent = yield await Promise.resolve(i)
      if (sent !== undefined) log.push("sent " + sent)
    }
    return "end"
  } finally {
    log.push("cleanup " + n)
  }
}

// for await over an async generator
const seen = []
for await (const x of numbers(3)) seen.push(x)

// direct next/return/throw calls answer with promises, queued in order
const g = numbers(5)
const queued = await Promise.all([g.next(), g.next("a"), g.return("stop"), g.next()])

// throw into a suspended async generator, caught inside
async function* guarded() {
  while (true) {
    try {
      yield "ready"
    } catch (e) {
      yield "caught " + e
    }
  }
}
const gd = guarded()
await gd.next()
const thrown = [await gd.throw("x"), await gd.next()]

// yield* over an async generator and over a sync iterable
async function* outer() {
  const r = yield* numbers(2)
  yield "inner returned " + r
  yield* [Promise.resolve("p"), "q"]
}
const delegated = []
for await (const v of outer()) delegated.push(v)

// break closes the generator and awaits its return
for await (const v of numbers(10)) {
  if (v === 1) break
}

// for await over a sync array of promises and plain values
const mixed = []
for await (const v of [Promise.resolve(1), 2, new Promise((r) => r(3))]) mixed.push(v)

// a rejection in the iterated array exits through try/catch
let rejected
try {
  for await (const v of [Promise.resolve(1), Promise.reject("bad")]) log.push("got " + v)
} catch (e) {
  rejected = e
}

// a custom async iterator
const custom = {
  [Symbol.asyncIterator]() {
    let i = 0
    return {
      next() {
        i++
        return Promise.resolve({ value: i * 10, done: i > 3 })
      },
      return() {
        log.push("custom return")
        return Promise.resolve({ done: true })
      },
    }
  },
}
const fromCustom = []
for await (const v of custom) {
  fromCustom.push(v)
  if (v === 20) break
}

// an error thrown in the body ends the generator and rejects its request
async function* failing() {
  yield 1
  throw new TypeError("nope")
}
const fg = failing()
const failed = [await fg.next()]
try {
  await fg.next()
} catch (e) {
  failed.push(e.name)
}
failed.push(await fg.next())

// async generators are not sync iterable, and their prototype chain holds
let notIterable
try {
  for (const v of numbers(1)) log.push(v)
} catch (e) {
  notIterable = e.name
}
const ag = numbers(1)
const shape = [
  typeof ag.next,
  ag[Symbol.asyncIterator]() === ag,
  ag instanceof numbers,
  Object.getPrototypeOf(numbers.prototype) === Object.getPrototypeOf(guarded.prototype),
]

// ordering: an async generator's steps interleave with other jobs
const order = []
async function* ticks() {
  order.push("start")
  yield 1
  order.push("resumed")
}
const t = ticks()
const p1 = t.next().then((r) => order.push("first " + r.value))
Promise.resolve().then(() => order.push("job"))
const p2 = t.next().then((r) => order.push("second " + r.done))
await p1
await p2

return { seen, queued, thrown, delegated, mixed, rejected, fromCustom, failed, notIterable, shape, order, log }
