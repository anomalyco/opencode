// The call depth limit with two and three frames per level, probed from the program's top level: the deepest level
// reached, the error there, and exactly the limit succeeding while one more level fails.
let map
{
  let m = 0
  const f = (n) => { m = n; [0].map(() => f(n + 1)) }
  try {
    f(1)
    map = [m, "no error"]
  } catch (e) {
    map = [m, e.name, e.message]
  }
}
let forEach
{
  let m = 0
  const f = (n) => { m = n; [0].forEach(() => f(n + 1)) }
  try {
    f(1)
    forEach = [m, "no error"]
  } catch (e) {
    forEach = [m, e.name, e.message]
  }
}
let reduce
{
  let m = 0
  const f = (n) => { m = n; return [0, 1].reduce(() => f(n + 1)) }
  try {
    f(1)
    reduce = [m, "no error"]
  } catch (e) {
    reduce = [m, e.name, e.message]
  }
}
let sort
{
  let m = 0
  const f = (n) => { m = n; return [0, 1].sort(() => f(n + 1)) }
  try {
    f(1)
    sort = [m, "no error"]
  } catch (e) {
    sort = [m, e.name, e.message]
  }
}
let toString
{
  let m = 0
  const f = (n) => { m = n; return String({ toString: () => f(n + 1) }) }
  try {
    f(1)
    toString = [m, "no error"]
  } catch (e) {
    toString = [m, e.name, e.message]
  }
}
let replace
{
  let m = 0
  const f = (n) => { m = n; return "a".replace("a", () => f(n + 1)) }
  try {
    f(1)
    replace = [m, "no error"]
  } catch (e) {
    replace = [m, e.name, e.message]
  }
}
let toJSON
{
  let m = 0
  const f = (n) => { m = n; return JSON.stringify({ toJSON: () => f(n + 1) }) }
  try {
    f(1)
    toJSON = [m, "no error"]
  } catch (e) {
    toJSON = [m, e.name, e.message]
  }
}
let arrayFrom
{
  let m = 0
  const f = (n) => { m = n; return Array.from([0], () => f(n + 1)) }
  try {
    f(1)
    arrayFrom = [m, "no error"]
  } catch (e) {
    arrayFrom = [m, e.name, e.message]
  }
}
let mapInMap
{
  let m = 0
  const f = (n) => { m = n; [0].map(() => [0].map(() => f(n + 1))) }
  try {
    f(1)
    mapInMap = [m, "no error"]
  } catch (e) {
    mapInMap = [m, e.name, e.message]
  }
}
let limit
{
  const r = (n) => (n > 1 ? [n - 1].map((x) => r(x))[0] : n)
  try {
    limit = r(5000)
  } catch (e) {
    limit = [e.name, e.message]
  }
}
let over
{
  const r = (n) => (n > 1 ? [n - 1].map((x) => r(x))[0] : n)
  try {
    over = r(5001)
  } catch (e) {
    over = [e.name, e.message]
  }
}
let threeLimit
{
  const r = (n) => (n > 1 ? [n - 1].map((x) => [x].map((y) => r(y))[0])[0] : n)
  try {
    threeLimit = r(3334)
  } catch (e) {
    threeLimit = [e.name, e.message]
  }
}
let threeOver
{
  const r = (n) => (n > 1 ? [n - 1].map((x) => [x].map((y) => r(y))[0])[0] : n)
  try {
    threeOver = r(3335)
  } catch (e) {
    threeOver = [e.name, e.message]
  }
}
return { map, forEach, reduce, sort, toString, replace, toJSON, arrayFrom, mapInMap, limit, over, threeLimit, threeOver }
