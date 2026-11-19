// The two symbols as the reference's host words them: text where its host's String makes them text, a refusal from
// its `+` and from ToNumber, no properties, and an object with no fields as JSON.
const t = (f) => { try { return f() } catch (e) { return [e.name, e.message] } }
const s = Symbol.iterator
const a = Symbol.asyncIterator
console.log(s, [a], { k: s })
return [
  t(() => String(s)), t(() => `${a}`), t(() => [s, a].join()), t(() => [1, 2].join(s)), t(() => String([s])),
  t(() => "" + s), t(() => s + 1), t(() => s + s), t(() => Number(s)), t(() => +s), t(() => Math.max(s)),
  t(() => parseInt(s)), t(() => parseFloat(a)), t(() => isNaN(s)), t(() => [1].at(s)), t(() => new Error(s).message),
  t(() => encodeURIComponent(s)), t(() => "abca".split(s, 1)), t(() => "abca".replace("a", s)), t(() => "ab".concat(s)),
  t(() => String.prototype.toUpperCase.call(s)), t(() => "ab".localeCompare(s)), t(() => s.description),
  t(() => s.toString()), t(() => { s.x = 1 }), t(() => delete s.x), t(() => s?.x), t(() => "x" in s),
  t(() => Object.prototype.toString.call(s)), t(() => JSON.stringify(s)), t(() => JSON.stringify({ s, n: [a] })),
  t(() => JSON.stringify([s], null, 1)), t(() => [s].sort().length), t(() => Object.entries(s)), t(() => ({ ...s })),
  t(() => undefined[s]), t(() => { null[s] = 1 }), t(() => new URLSearchParams(s)), t(() => Object(s)),
  t(() => Object.getPrototypeOf(s)), t(() => s == s), t(() => [s].includes(s)), s, [a],
]
