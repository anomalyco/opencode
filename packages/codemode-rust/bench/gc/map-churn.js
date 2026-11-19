// A churning Map and Set: each event adds entries and deletes old ones, so both stay near 2,000 entries.
const m = new Map()
const s = new Set()
let n = 0
while (true) {
  const e = await nextEvent()
  if (e === null) return m.size + s.size
  for (let j = 0; j < 20; j++, n++) {
    m.set("key" + n, { n, at: e.i })
    s.add(n)
    if (n >= 2000) {
      m.delete("key" + (n - 2000))
      s.delete(n - 2000)
    }
  }
  render(String(m.size))
}
