const a = [1, 2, 3]
a.push(4, 5)
const popped = a.pop()
a.unshift(0)
const shifted = a.shift()
const spliced = a.splice(1, 1, "x", "y")
return [a, popped, shifted, spliced, a.slice(1, 3), a.slice(-2), a.concat([9], 10), a.indexOf("x"), a.includes(4), a.join("-"), [3, 1, 2].reverse(), a.length, a.at(-1)]
