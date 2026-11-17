const all = Promise.all([Promise.resolve(1)])
const settled = Promise.allSettled([Promise.reject("no")])
const race = Promise.race([Promise.resolve(2)])
const promises = [all instanceof Promise, settled instanceof Promise, race instanceof Promise]
return [promises, await all, await settled, await race]
