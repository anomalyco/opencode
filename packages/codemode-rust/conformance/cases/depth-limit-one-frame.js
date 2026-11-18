// The call depth limit with one frame per level, probed from the program's top level: the deepest level reached,
// the error there, and exactly the limit succeeding while one more level fails.
let plain
{
  let m = 0
  const f = (n) => { m = n; f(n + 1) }
  try {
    f(1)
    plain = [m, "no error"]
  } catch (e) {
    plain = [m, e.name, e.message]
  }
}
let method
{
  let m = 0
  const o = { f(n) { m = n; this.f(n + 1) } }
  try {
    o.f(1)
    method = [m, "no error"]
  } catch (e) {
    method = [m, e.name, e.message]
  }
}
let call
{
  let m = 0
  function f(n) { m = n; f.call(null, n + 1) }
  try {
    f(1)
    call = [m, "no error"]
  } catch (e) {
    call = [m, e.name, e.message]
  }
}
let apply
{
  let m = 0
  function f(n) { m = n; f.apply(null, [n + 1]) }
  try {
    f(1)
    apply = [m, "no error"]
  } catch (e) {
    apply = [m, e.name, e.message]
  }
}
let generator
{
  let m = 0
  function* g(n) { m = n; yield* g(n + 1) }
  try {
    [...g(1)]
    generator = [m, "no error"]
  } catch (e) {
    generator = [m, e.name, e.message]
  }
}
let asyncFn
{
  let m = 0
  const f = async (n) => { m = n; await f(n + 1) }
  try {
    await f(1)
    asyncFn = [m, "no error"]
  } catch (e) {
    asyncFn = [m, e.name, e.message]
  }
}
let limit
{
  const r = (n) => (n > 1 ? r(n - 1) : n)
  try {
    limit = r(10000)
  } catch (e) {
    limit = [e.name, e.message]
  }
}
let over
{
  const r = (n) => (n > 1 ? r(n - 1) : n)
  try {
    over = r(10001)
  } catch (e) {
    over = [e.name, e.message]
  }
}
return { plain, method, call, apply, generator, asyncFn, limit, over }
