const make = (ret) => ({ [Symbol.iterator]: () => ({ next: () => ({ done: false, value: [1] }), return: ret }) })
const blanks = (ret) => ({ [Symbol.iterator]: () => ({ next: () => ({ done: false }), return: ret }) })
const outcomes = []
for (const [label, ret] of [
  ["null", () => null],
  ["throws", () => { throw new RangeError("close") }],
  ["ok", () => ({ done: true })],
]) {
  function* loop() { for (const [a] of make(ret)) yield a }
  function* pattern() { for ([ {} = yield ] of [blanks(ret)]) {} }
  for (const g of [loop(), pattern()]) {
    g.next()
    try { g.return(7); outcomes.push(label + " quiet") } catch (e) { outcomes.push(label + " " + e.constructor.name) }
  }
}
return outcomes
