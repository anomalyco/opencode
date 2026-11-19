// Closures: each event makes handlers that capture its state, and keeps the latest ten.
let handlers = []
let total = 0
while (true) {
  const e = await nextEvent()
  if (e === null) return total
  for (let j = 0; j < 30; j++) {
    let count = j
    const label = e.query + j
    handlers.push(() => {
      count++
      return label.length + count
    })
  }
  handlers = handlers.slice(-10)
  for (const h of handlers) total += h()
  render(String(total))
}
