// Calling or constructing what cannot be: the callee is named like native engines name it, or "The called value".
const attempt = async (f) => {
  try {
    return await f()
  } catch (error) {
    return String(error)
  }
}
const o = { a: 1, nested: { x: 5 } }
const list = [1]
let nothing
return {
  identifier: await attempt(() => nothing()),
  member: await attempt(() => o.missing()),
  nested: await attempt(() => o.nested.x()),
  literalKey: await attempt(() => o["a"]()),
  variableKey: await attempt(() => {
    const k = "a"
    return o[k]()
  }),
  index: await attempt(() => list[0]()),
  callResult: await attempt(() => (() => 1)()()),
  chained: await attempt(() => o.nested.deep?.x.y()),
  optional: await attempt(() => o.a?.()),
  spread: await attempt(() => o.a(...[1])),
  tagged: await attempt(() => o.a`x`),
  onThis: await attempt(() => function () { return this.x() }.call({ x: 2 })),
  builtin: await attempt(() => Math.nope()),
  newValue: await attempt(() => new o.a()),
  newArrow: await attempt(() => new (() => 1)()),
  newBuiltin: await attempt(() => new Math.max()),
  receivers: [
    await attempt(() => Function.prototype.call.call(5)),
    await attempt(() => Function.prototype.apply.call({})),
    await attempt(() => Function.prototype.bind.call("x")),
  ],
  callbacks: [
    await attempt(() => [1].map(5)),
    await attempt(() => [1].reduceRight()),
    await attempt(() => [2, 1].sort(5)),
    await attempt(() => Array.from([1], 5)),
    await attempt(() => new Map([[1, 2]]).forEach(5)),
    await attempt(() => new Set([1]).forEach(5)),
    await attempt(() => new Promise(5)),
    await attempt(() => Promise.try(5)),
    await attempt(() => new Uint8Array(2).sort(5)),
  ],
}
