const sum = (...xs) => xs.reduce((a, b) => a + b, 0)
const arr = [1, 2, 3]
const merged = { ...{ a: 1, b: 2 }, b: 3, ...{ c: 4 } }
return [sum(...arr, 4), [0, ...arr, ...[9]], merged, Math.max(...arr)]
