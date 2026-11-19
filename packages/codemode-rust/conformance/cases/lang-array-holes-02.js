// The callback methods skip holes, except the find methods, which visit them as undefined.
const a = [1, , 3]
const visits = []
a.forEach((v, i) => visits.push(i))
const found = []
a.find((v) => {
  found.push(v === undefined ? "hole" : v)
  return false
})
const reduceEmpty = (() => {
  try {
    return [, , ].reduce((x, y) => x + y)
  } catch (error) {
    return String(error)
  }
})()
const reduceRightEmpty = (() => {
  try {
    return [, ].reduceRight((x, y) => x + y)
  } catch (error) {
    return String(error)
  }
})()
const big = []
big[100] = 1
// Elements deleted while a method runs are skipped when it reaches them.
const shrinking = [1, 2, 3, 4]
const seenShrinking = []
shrinking.forEach((v) => {
  seenShrinking.push(v)
  shrinking.length = 2
})
return {
  visits,
  map: [a.map((v) => v * 2), 1 in a.map((v) => v), Array(2).map(() => 1)],
  filter: a.filter(() => true),
  someEvery: [[, ].every(() => false), [, ].some(() => true)],
  reduce: [[1, , 3].reduce((x, y) => x + y), [1, , 3].reduceRight((x, y) => x + "" + y)],
  reduceEmpty,
  reduceRightEmpty,
  found,
  findIndex: [[, 5].findIndex((v) => v === undefined), [, 5].findLast((v) => v === undefined)],
  flatMap: [1, , 3].flatMap((v) => [v, , v]),
  search: [a.indexOf(undefined), a.includes(undefined), a.lastIndexOf(undefined), [].includes(), [].indexOf()],
  big: [big.length, 50 in big, big.indexOf(undefined), big.filter(() => true).length],
  seenShrinking,
}
