// A command palette: each event filters 300 commands by a query and renders the top rows. Only the selection
// survives an event; everything else it allocates is garbage by the next one.
const commands = Array.from({ length: 300 }, (_, i) => ({
  id: "cmd." + i,
  title: "Command number " + i,
  keywords: ["k" + (i % 17), "group" + (i % 5)],
}))
let selected = 0
while (true) {
  const e = await nextEvent()
  if (e === null) return { selected }
  const q = e.query
  const rows = commands
    .filter((c) => c.title.includes(q) || c.keywords.some((k) => k.startsWith(q)))
    .map((c, i) => ({ key: c.id, text: (i === selected ? "> " : "  ") + c.title.toUpperCase(), score: c.title.length - q.length }))
  rows.sort((a, b) => a.score - b.score || (a.key < b.key ? -1 : 1))
  selected = (selected + 1) % Math.max(rows.length, 1)
  render(rows.slice(0, 20).map((r) => `${r.key}: ${r.text}`).join("\n"))
}
