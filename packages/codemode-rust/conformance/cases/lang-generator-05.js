let iterator
function* generate() {
  try { iterator.next() } catch (error) { return error.name }
}
iterator = generate()
return iterator.next()
