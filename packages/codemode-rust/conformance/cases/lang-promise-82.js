const winner = await Promise.any([
  tools.host.fail({}),
  tools.host.echo({ id: 1 }),
  tools.host.pending({ id: 2 }),
])
return winner
