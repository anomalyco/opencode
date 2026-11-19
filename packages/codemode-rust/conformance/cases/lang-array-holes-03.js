// Mutating and copying methods keep, fill or drop holes like their reference, and holes read through the prototype.
const has = (array, ...indexes) => indexes.map((i) => i in array)
const sorted = [3, , undefined, 1]
sorted.sort()
const compared = [, 2, undefined, 1]
compared.sort((x, y) => x - y)
const shifted = [1, , 3]
shifted.shift()
const unshifted = [1, , 3]
unshifted.unshift(0)
const spliced = [1, , 3, 4]
const removed = spliced.splice(0, 2)
const frozen = (() => {
  try {
    const n = Object.preventExtensions([1, , 3])
    n[1] = 2
    return n
  } catch (error) {
    return String(error)
  }
})()
const out = {
  sorted: [sorted.length, ...has(sorted, 1, 2, 3), sorted[0], sorted[1]],
  compared: [compared, ...has(compared, 2, 3)],
  toSorted: [3, , 1].toSorted(),
  slice: has(a(), 1).concat(has([].concat(a()), 1), has(a().slice(), 1)),
  reverse: has([1, , 3, 4].reverse(), 2),
  copies: [has([1, , 3].toReversed(), 1), has([1, , 3].toSpliced(0, 0), 1), has([1, , 3].with(0, 9), 1)],
  flat: [[1, , 3], , [4]].flat(),
  splice: [has(removed, 1), spliced],
  copyWithin: has([1, , 3, 4].copyWithin(2, 0), 3),
  fill: has(new Array(2).fill(0), 1),
  pop: [[, ].pop() === undefined, [1, , ].length],
  shift: [has(shifted, 0), shifted.length],
  unshift: has(unshifted, 2),
  at: a().at(1) === undefined,
  frozen,
}
function a() {
  return [1, , 3]
}
Array.prototype[1] = "inherited"
const holey = a()
const visited = []
holey.forEach((v) => visited.push(v))
out.inherited = {
  read: [holey[1], 1 in holey, holey.hasOwnProperty(1), [...holey][1] === undefined, holey.join()],
  search: [holey.indexOf("inherited"), holey.includes("inherited")],
  visited,
  map: holey.map((v) => v),
  find: holey.find((v) => v === "inherited"),
  filter: holey.filter(() => true),
  locale: holey.toLocaleString(),
  flat: [[1, , 3]].flat(),
  flatMap: [0].flatMap(() => [1, , 3]),
  json: JSON.stringify(holey),
  pastEnd: [[0][1], [0, , ][1]],
}
delete Array.prototype[1]
return out
