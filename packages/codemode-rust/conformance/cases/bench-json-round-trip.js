const make = (depth) => depth === 0 ? { a: 1, b: "two", c: [1, 2, 3], d: null } : { left: make(depth - 1), right: make(depth - 1), list: [depth, String(depth)] }
let size = 0
for (let i = 0; i < 20; i++) size += JSON.stringify(JSON.parse(JSON.stringify(make(9)))).length
return size
