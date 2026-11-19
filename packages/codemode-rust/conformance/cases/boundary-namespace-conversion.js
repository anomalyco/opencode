// A namespace reference is no object to the built-ins that convert it: it converts without a call, to the text
// "[object Object]" (so NaN as a number), and starts no conversion of its own.
const t = (f) => { try { return f() } catch (e) { return [e.name, e.message] } }
const o = { valueOf: () => 3, toString: () => "o" }
return [
  t(() => String(tools)),
  t(() => `${tools.git}`),
  t(() => String(tools.git.status)),
  t(() => [1, 2].join(tools)),
  t(() => [tools, tools.git].join()),
  t(() => Math.max(tools)),
  t(() => Math.max(o, tools.git, 1)),
  t(() => parseInt(tools)),
  t(() => Number(tools.git)),
  t(() => isNaN(tools)),
  t(() => [1].at(tools)),
  t(() => String(new Date(tools))),
  t(() => new Error(tools).message),
  t(() => encodeURIComponent(tools)),
  t(() => new Array(tools).length),
  t(() => Array.from({ length: tools })),
  t(() => String.fromCharCode(tools, 65)),
  t(() => ({ [tools]: 1 })),
  t(() => { const { [tools.git]: a } = { "[object Object]": 2 }; return a }),
  t(() => Object.prototype.toString.call(tools)),
  t(() => tools + 1),
  t(() => -tools),
]
