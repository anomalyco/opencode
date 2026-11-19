// Which functions callback sites admit: built-ins, bound functions and closures, but not the Promise statics, Symbol,
// or a tool, each refused with the site's own wording.
const sites = {
  map: (f) => [1].map(f),
  sort: (f) => [2, 1].sort(f),
  then: (f) => Promise.resolve(1).then(f),
  catch: (f) => Promise.reject(1).catch(f),
  finally: (f) => Promise.resolve(1).finally(f),
  replace: (f) => "a".replace("a", f),
  replaceAll: (f) => "a".replaceAll("a", f),
  parse: (f) => JSON.parse("[1]", f),
  stringify: (f) => JSON.stringify([1], f),
}
const callables = {
  abs: Math.abs,
  string: String,
  bound: ((x) => x).bind(null),
  arrow: (x) => x,
  resolve: Promise.resolve,
  all: Promise.all,
  withResolvers: Promise.withResolvers,
  symbol: Symbol,
  tool: tools.echo,
  nested: tools.git.status,
  number: 5,
}
const out = []
for (const [s, site] of Object.entries(sites)) {
  for (const [c, f] of Object.entries(callables)) {
    try {
      const v = site(f)
      out.push([s, c, v instanceof Promise ? "promise" : v])
    } catch (e) {
      out.push([s, c, e.name, e.message])
    }
  }
}
for (const f of [() => Symbol("s"), () => new Symbol(), () => (tools.x = 1), () => (tools.git.x = 1)]) {
  try {
    out.push(f())
  } catch (e) {
    out.push([e.name, e.message])
  }
}
return out
