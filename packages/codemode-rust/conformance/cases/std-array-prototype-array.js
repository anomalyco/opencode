const out = [Array.isArray(Array.prototype), Array.prototype.length, JSON.stringify(Array.prototype), Object.keys(Array.prototype).length, String(Array.prototype), typeof Array.prototype.map]
Array.prototype[0] = "proto"
const a = []
out.push(a[0], a.length, Array.prototype.length, [1].concat([2]).length)
Array.prototype.length = 0
console.log(Array.prototype)
delete Array.prototype[0]
Array.prototype[1] = "p"; const a2 = [0, , 2]; out.push(a2[1], 1 in a2, a2.indexOf("p"), a2.includes("p"), JSON.stringify(a2), a2.map((x) => x).join(), [].concat(a2).length); a2.forEach((x, i) => out.push(i + x)); delete Array.prototype[1]; out.push(a2[1], 1 in a2); return out
