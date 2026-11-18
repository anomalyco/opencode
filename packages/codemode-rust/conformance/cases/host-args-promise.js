// @translate {"functions": "drop", "promises": "await"}
// A tool's arguments await a promise inside them, a pending one first, and leave a function out; a rejection fails
// the call with its reason.
const nested = await tools.echo({ id: tools.echo({ id: 1 }) })
const slow = await tools.echo({ id: (async () => { await null; await null; return 2 })() })
const fn = await tools.git.status({ f: () => 1 }).then((s) => s.branch, (e) => e.message)
const rejected = await tools.echo({ id: tools.fail({}) }).catch((e) => e.message)
const unknown = await tools.git.stat({ id: tools.echo({ id: 3 }) }).catch((e) => e.message)
return [nested, slow, fn, rejected, unknown]
