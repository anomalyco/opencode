// Assigning a built-in global, `undefined` included, fails as assigning a constant does; an unknown name is unknown.
const attempt = (f) => {
  try {
    return f()
  } catch (error) {
    return String(error)
  }
}
return [
  attempt(() => {
    undefined = 12
  }),
  attempt(() => {
    undefined ??= 1
  }),
  attempt(() => {
    ;[undefined] = [1]
  }),
  attempt(() => {
    for (undefined of [1]);
  }),
  attempt(() => {
    NaN = 1
  }),
  attempt(() => {
    Math = 1
  }),
  attempt(() => {
    unknownName = 1
  }),
  (() => {
    let undefined = 3
    undefined = 4
    return undefined
  })(),
]
