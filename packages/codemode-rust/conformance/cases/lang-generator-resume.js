const log = []
function* count(n) {
  try {
    for (let i = 0; i < n; i++) {
      const sent = yield i
      if (sent !== undefined) log.push("sent " + sent)
    }
    return "done"
  } finally {
    log.push("cleanup " + n)
  }
}

// for...of resumes on the same loop, nested generators included
const pairs = []
for (const a of count(3)) for (const b of count(2)) pairs.push(a * 10 + b)

// break closes the generator through its finally
for (const x of count(5)) if (x === 1) break

// spread, rest destructuring, Array.from and Set consume it whole
const spread = [0, ...count(3), 9]
const [first, ...rest] = count(4)
const [p, q] = count(10)
const fromAll = Array.from(count(2))
const set = new Set(count(3))
const args = Math.max(...count(6))

// direct next() calls, with sent values and return()
const g = count(3)
const steps = [g.next("ignored"), g.next("a"), g.next("b"), g.next(), g.next(), g.return(7)]
const h = count(3)
h.next()
const returned = h.return("early")

// yield* delegates and receives the completion value
function* outer() {
  const r = yield* count(2)
  yield "inner returned " + r
  yield* [7, 8]
}
const delegated = [...outer()]

// an exception thrown inside propagates to the consumer and finishes the generator
function* boom() {
  yield 1
  throw new Error("bad")
}
let caught = null
const it = boom()
try {
  for (const v of it) log.push("got " + v)
} catch (e) {
  caught = e.message
}
const after = it.next()

// generators that call functions and are resumed from callbacks
function* mapped(xs) {
  for (const x of xs) yield [x].map((y) => y * 2)[0]
}
const viaCallbacks = [1, 2, 3].map((n) => [...mapped([n, n + 1])].join("+"))

// a generator running while another is created and consumed inside it
function* nesting() {
  const inner = [...count(2)]
  yield inner.length
  for (const v of count(2)) yield v + 100
}

// destructuring an argument and a generator that never yields
function* empty() {}
const [e1 = "default"] = empty()

return {
  pairs,
  spread,
  first,
  rest,
  p,
  q,
  fromAll,
  set: [...set],
  args,
  steps,
  returned,
  delegated,
  caught,
  after,
  viaCallbacks,
  nesting: [...nesting()],
  e1,
  log,
}
