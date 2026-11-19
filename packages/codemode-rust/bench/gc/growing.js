// A growing live set: each event keeps one record in a log and throws away some scratch work.
const log = []
while (true) {
  const e = await nextEvent()
  if (e === null) return log.length
  const scratch = []
  for (let j = 0; j < 20; j++) scratch.push({ j, label: "s" + j + ":" + e.i })
  log.push({ i: e.i, query: e.query, tag: "event " + e.i, size: scratch.length })
  render(log[log.length - 1].tag)
}
