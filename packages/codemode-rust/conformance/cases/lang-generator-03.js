function* generate() {
  try {
    try { yield "try" } catch (error) { yield "caught " + error }
  } finally {
    yield "finally"
  }
}
const iterator = generate()
return [iterator.next(), iterator.throw("boom"), iterator.return("done"), iterator.next()]
