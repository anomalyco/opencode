// The arguments object: indexed own properties that delete leaves as holes, a hidden writable length, and a
// binding that can be reassigned.
function f() {
  const deleted = delete arguments[1]
  arguments.extra = "x"
  return {
    deleted,
    afterDelete: [typeof arguments[1], 1 in arguments, arguments.length],
    keys: Object.keys(arguments),
    spread: [...arguments],
    json: JSON.stringify(arguments),
    tag: Object.prototype.toString.call(arguments),
  }
}
function g() {
  arguments.length = "two"
  const lengthWritten = [arguments.length, arguments.hasOwnProperty("length"), Object.keys(arguments).length]
  arguments.length = 1
  const applied = ((...xs) => xs).apply(null, arguments)
  const deleted = delete arguments.length
  return { lengthWritten, applied, deleted, after: arguments.length }
}
function h(a) {
  arguments = [9]
  const fromArrow = (() => {
    arguments = "arrow"
    return arguments
  })()
  return [a, arguments, fromArrow]
}
function frozen() {
  Object.freeze(arguments)
  try {
    arguments[0] = 2
  } catch (error) {
    return [String(error), arguments[0]]
  }
}
return { f: f(1, 2, 3), g: g(1, 2, 3), h: h(1), frozen: frozen(1) }
