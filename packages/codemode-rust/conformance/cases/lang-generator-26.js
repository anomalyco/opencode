async function* generate() {
  try {
    try { yield 1; yield 2 } catch (error) { yield "caught " + error }
  } finally {
    yield "finally"
  }
}
const iterator = generate()
const first = iterator.next()
const thrown = iterator.throw("x")
const returned = iterator.return("done")
const last = iterator.next()
return await Promise.all([first, thrown, returned, last])
