const events = []
function* generate() {
  try { yield 1; yield 2 } finally { events.push("closed") }
}
for (const item of generate()) break
return events
