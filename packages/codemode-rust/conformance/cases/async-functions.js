async function inc(x) { return x + 1 }
const p = inc(1)
const arrow = async (x) => (await inc(x)) * 10
return [typeof p.then, await p, await arrow(2)]
