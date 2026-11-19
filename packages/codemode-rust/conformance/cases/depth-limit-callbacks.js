// The call depth limit where a built-in calls back the recursing function itself, one frame per level, probed from
// the program's top level.
let map
{
  let m = 0
  const f = () => { m++; [0].map(f) }
  try {
    f()
    map = [m, "no error"]
  } catch (e) {
    map = [m, e.name, e.message]
  }
}
let forEach
{
  let m = 0
  const f = () => { m++; [0].forEach(f) }
  try {
    f()
    forEach = [m, "no error"]
  } catch (e) {
    forEach = [m, e.name, e.message]
  }
}
let toString
{
  let m = 0
  const o = { toString() { m++; return String(this) } }
  try {
    String(o)
    toString = [m, "no error"]
  } catch (e) {
    toString = [m, e.name, e.message]
  }
}
let replace
{
  let m = 0
  const f = () => { m++; return "a".replace("a", f) }
  try {
    f()
    replace = [m, "no error"]
  } catch (e) {
    replace = [m, e.name, e.message]
  }
}
let toJSON
{
  let m = 0
  const o = { toJSON() { m++; return JSON.stringify(o) } }
  try {
    JSON.stringify(o)
    toJSON = [m, "no error"]
  } catch (e) {
    toJSON = [m, e.name, e.message]
  }
}
let arrayFrom
{
  let m = 0
  const f = () => { m++; return Array.from([0], f) }
  try {
    f()
    arrayFrom = [m, "no error"]
  } catch (e) {
    arrayFrom = [m, e.name, e.message]
  }
}
let reduce
{
  let m = 0
  const f = () => { m++; return [0, 1].reduce(f) }
  try {
    f()
    reduce = [m, "no error"]
  } catch (e) {
    reduce = [m, e.name, e.message]
  }
}
let sort
{
  let m = 0
  const f = () => { m++; [0, 1].sort(f); return 0 }
  try {
    f()
    sort = [m, "no error"]
  } catch (e) {
    sort = [m, e.name, e.message]
  }
}
let limit
{
  const r = (n) => (n > 1 ? [n - 1].map(r)[0] : n)
  try {
    limit = r(10000)
  } catch (e) {
    limit = [e.name, e.message]
  }
}
let over
{
  const r = (n) => (n > 1 ? [n - 1].map(r)[0] : n)
  try {
    over = r(10001)
  } catch (e) {
    over = [e.name, e.message]
  }
}
return { map, forEach, toString, replace, toJSON, arrayFrom, reduce, sort, limit, over }
