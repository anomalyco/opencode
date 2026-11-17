const o = { b: 1, a: 2, 10: "ten", 2: "two" }
return [Object.keys(o), Object.values(o), Object.entries({ x: 1, y: [2] }), Object.assign({}, { a: 1 }, { b: 2 }), Object.fromEntries([["p", 1], ["q", 2]]), Object.hasOwn(o, "a"), o.hasOwnProperty("zz")]
