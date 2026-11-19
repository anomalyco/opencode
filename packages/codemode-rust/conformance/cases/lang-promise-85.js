const first = Promise.resolve().then(() => "one")
const second = Promise.resolve().then(() => "two")
return await Promise.any([second, first])
