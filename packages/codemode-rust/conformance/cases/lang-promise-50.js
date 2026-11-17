const nested = Promise.all([
  tools.host.pending({ id: 1 }),
  tools.host.pending({ id: 2 }),
])
return await Promise.race(["immediate", nested])
