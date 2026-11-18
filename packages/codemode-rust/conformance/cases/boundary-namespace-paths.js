// Reading a namespace path: names only, Object.keys and for...in of an unknown one fail, a namespace is not a
// function, and the receivers of Promise.prototype methods are named when they are wrong.
const t = (f) => { try { return f() } catch (e) { return [e.name, e.message] } }
const forIn = (v) => { const ks = []; for (const k in v) ks.push(k); return ks }
return [
  t(() => typeof tools[0]), t(() => typeof tools.git[1.5]), t(() => tools[Symbol.iterator]), t(() => { tools[0] = 1 }),
  t(() => typeof tools["0"]), t(() => typeof tools[true]), t(() => typeof tools[{ toString: () => "git" }]),
  t(() => Object.keys(tools.nope)), t(() => forIn(tools.git.nope)), t(() => Object.keys(tools.git.status.x)),
  t(() => Object.keys(tools.git.status)), t(() => Object.keys(tools.git)), t(() => forIn(tools)),
  t(() => Promise.prototype.then.call({}, () => 1)), t(() => Promise.prototype.catch.call(5)),
  t(() => Promise.prototype.finally.call(tools)), t(() => Promise.prototype.then.call(null)),
  t(() => new URLSearchParams(Symbol.iterator)), t(() => new URLSearchParams(tools)),
  t(() => { const n = null; let c = 0; try { n[{ toString() { c++; return "k" } }] } catch (e) { return [e.message, c] } }),
  t(() => { const n = undefined; n[[1, 2]] = 1 }),
]
