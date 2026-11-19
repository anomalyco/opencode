// String building: each event builds a few KB of text with += and templates, and keeps only the last one.
let last = ""
while (true) {
  const e = await nextEvent()
  if (e === null) return last.length
  let out = ""
  for (let j = 0; j < 60; j++) out += `row ${j} of event ${e.i}: ${e.query.repeat(3)}\n`
  last = out.toUpperCase()
  render(last.slice(0, 40))
}
