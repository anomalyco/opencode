let settle
const manual = new Promise((resolve) => { settle = resolve })
const race = Promise.race([manual, tools.host.pending({ id: 3 })])
const all = Promise.all([manual, "plain"])
const any = Promise.any([manual, new Promise(() => {})])
settle("manual")
return [await race, await all, await any]
