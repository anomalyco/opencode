const a = await tools.echo({ id: 1 })
const b = await tools["echo"]({ id: 2 })
const s = await tools.git.status()
return [a, b, s, s.branch]
