// A combinator rejects, rather than throws, when its input is not iterable or iterating it fails.
const settle = async (name, input) => {
  try {
    return await Promise[name](input).then(
      (value) => ["fulfilled", value],
      (error) => ["rejected", String(error)],
    )
  } catch (error) {
    return ["thrown", String(error)]
  }
}
const inputs = [
  5,
  null,
  {},
  "ab",
  {
    [Symbol.iterator]() {
      throw new Error("open")
    },
  },
  { [Symbol.iterator]: () => ({ next: () => { throw new Error("next") } }) },
]
const out = {}
for (const name of ["all", "allSettled", "any", "race"]) {
  out[name] = []
  for (const input of inputs) out[name].push(await settle(name, input))
}
return out
