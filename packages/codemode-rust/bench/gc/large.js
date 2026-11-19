// A large live set: 200,000 records (about 600,000 objects and strings) stay reachable while each event updates 50
// of them with new values and throws away a page of derived rows.
const records = []
for (let i = 0; i < 200000; i++) records.push({ id: i, name: "record " + i, tags: [i % 7, i % 11] })
let n = 0
while (true) {
  const e = await nextEvent()
  if (e === null) return n
  for (let j = 0; j < 50; j++) {
    const r = records[(e.i * 50 + j) % records.length]
    r.tags = [e.i, j]
    n += r.name.length
  }
  const from = (e.i * 7) % 1000
  const page = records.slice(from, from + 200).map((r) => ({ id: r.id, label: r.name + "!" }))
  render(String(page.length + n))
}
