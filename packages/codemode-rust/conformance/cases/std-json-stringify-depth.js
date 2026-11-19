const nest = (n, v, wrap) => {
  let o = v
  for (let i = 0; i < n; i++) o = wrap(o)
  return o
}
const t = (f) => {
  try {
    return f()
  } catch (e) {
    return [e.name, e.message]
  }
}
const obj = (o) => ({ o })
const arr = (o) => [o]
return [
  t(() => JSON.stringify(nest(32, 1, obj)).length),
  t(() => JSON.stringify(nest(33, 1, obj)).length),
  t(() => JSON.stringify(nest(32, {}, obj)).length),
  t(() => JSON.stringify(nest(33, {}, obj)).length),
  t(() => JSON.stringify(nest(32, 1, arr)).length),
  t(() => JSON.stringify(nest(33, 1, arr)).length),
  t(() => JSON.stringify(nest(33, undefined, obj)).length),
  t(() => JSON.stringify(nest(100, 1, obj), (k, v) => v).length),
  t(() => JSON.stringify(nest(101, 1, obj), (k, v) => v).length),
  t(() => JSON.stringify(nest(40, 1, obj), null, 1).length),
  t(() => JSON.stringify(nest(40, { toJSON: () => 1 }, obj)).length),
  t(() => JSON.stringify([nest(20, { toJSON: () => 1 }, obj), nest(40, 1, obj)]).length),
]
