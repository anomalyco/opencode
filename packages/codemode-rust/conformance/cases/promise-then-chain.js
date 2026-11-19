const v = await Promise.resolve(1).then((x) => x + 1).then((x) => x * 10)
const r = await Promise.reject(new Error("no")).catch((e) => e.message)
return [v, r]
