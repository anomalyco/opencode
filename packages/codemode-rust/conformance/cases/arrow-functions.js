const sq = (x) => x * x
const add = (a, b = 10) => { return a + b }
const obj = () => ({ k: 1 })
return [sq(4), add(1), add(1, 2), obj()]
