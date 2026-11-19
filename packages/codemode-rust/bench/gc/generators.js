// Generators kept alive: a few long-lived ones advance each event, and each event starts and drops short ones.
function* counter(prefix) {
  let i = 0
  while (true) yield { text: prefix + i++ }
}
const alive = [counter("a"), counter("b"), counter("c")]
let sum = 0
while (true) {
  const e = await nextEvent()
  if (e === null) return sum
  for (const g of alive) sum += g.next().value.text.length
  for (let j = 0; j < 10; j++) {
    const g = counter(e.query)
    for (let k = 0; k < 5; k++) sum += g.next().value.text.length
  }
  render(String(sum))
}
