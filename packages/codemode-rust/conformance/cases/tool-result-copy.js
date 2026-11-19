const s = await tools.git.status()
s.branch = "changed"
const t = await tools.git.status()
return [s.branch, t.branch]
