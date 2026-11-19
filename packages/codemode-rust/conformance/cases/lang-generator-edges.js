const out = []

// re-entering a running generator is a TypeError
let self
function* reenter() {
  try {
    self.next()
  } catch (e) {
    yield e.constructor.name
  }
}
self = reenter()
out.push(self.next().value)

// throw() into a suspended generator, caught and handled inside
function* guarded() {
  while (true) {
    try {
      yield "waiting"
    } catch (e) {
      yield "caught " + e
    }
  }
}
const gd = guarded()
gd.next()
out.push(gd.throw("x").value, gd.next().value, gd.throw("y").value)

// an exception from a generator being spread is catchable by the spreading code
function* failing() {
  yield 1
  throw new RangeError("stop")
}
try {
  out.push([...failing()])
} catch (e) {
  out.push(e.name)
}

// a destructuring default that throws closes the generator
function* tracked() {
  try {
    yield undefined
    yield 2
  } finally {
    out.push("closed")
  }
}
try {
  const [a = (() => { throw "default failed" })()] = tracked()
  out.push(a)
} catch (e) {
  out.push(e)
}

// deep recursion through yield*
function* depth(n) {
  if (n === 0) {
    yield "bottom"
    return
  }
  yield* depth(n - 1)
}
out.push([...depth(200)])

// return() while suspended inside try/finally that yields
function* finallyYields() {
  try {
    yield 1
  } finally {
    yield "from finally"
  }
}
const fy = finallyYields()
fy.next()
out.push(fy.return(5), fy.next(), fy.next())

// a generator consumed partly by for...of, then by next()
function* five() {
  for (let i = 0; i < 5; i++) yield i
}
const fv = five()
for (const v of fv) {
  if (v === 2) break
}
out.push(fv.next())

// the loop variable is a fresh binding each step, as closures see
const fns = []
for (const v of five()) fns.push(() => v)
out.push(fns.map((f) => f()))

// a yield inside a template, call argument and object literal
function* exprs() {
  const r = `${yield 1}-${yield 2}`
  const o = { a: yield 3, b: Math.max(yield 4, 0) }
  return [r, o]
}
const ex = exprs()
const seen = [ex.next().value]
seen.push(ex.next("p").value, ex.next("q").value, ex.next(10).value)
seen.push(ex.next(20))
out.push(seen)

return out
