function outer(a, b) {
  const viaArrow = () => arguments.length
  const nested = () => () => arguments[1]
  const same = arguments === arguments
  arguments[0] = "changed"
  return [viaArrow(), nested()(), same, a, arguments[0]]
}
function defaults(x, y = 1) {
  arguments[0] = 5
  x = 2
  return [x, arguments[0], arguments.length]
}
function extra() {
  arguments[3] = "late"
  return [arguments[3], arguments.length]
}
let reads = 0
const key = {
  toString() {
    reads++
    return "k"
  },
}
const o = { k: 1 }
o[key] += 1
o[key]++
const order = []
const lit = { [(order.push("key"), { toString: () => (order.push("convert"), "p") })]: order.push("value") }
return [outer(1, 2), defaults(), extra(), reads, o.k, order, Object.keys(lit), "\u{1F600}" < "\uFFFF", "a" < "b"]
