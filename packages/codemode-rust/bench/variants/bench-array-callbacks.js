const COUNT = 5e4
const values = Array.from({ length: COUNT }, function (unused, idx) {
  return (7919 * idx) % COUNT
})
function twice(v) {
  return v + v
}
const kept = values.map(twice).filter(function (v) {
  return v % 3 != 0
})
const sum = kept.reduce(function (acc, v) {
  return acc + v
}, 0)
function ascending(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}
const ordered = kept.slice(0, 2e4).sort(ascending)
const last = ordered.length - 1
return [sum, ordered[0], ordered[last]]
