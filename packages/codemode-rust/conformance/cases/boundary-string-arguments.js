// An argument a String method reads that is still a promise or a namespace once the receiver and the arguments
// converted is not data; anything else converts (a function, a generator, a namespace inside an array).
const t = (f) => { try { return f() } catch (e) { return [e.name, e.message] } }
const p = Promise.resolve(1)
const s = "abca"
return [
  t(() => s.indexOf(p)), t(() => s.indexOf("a", tools)), t(() => s.lastIndexOf(tools.git)),
  t(() => s.includes(p)), t(() => s.startsWith("a", p)), t(() => s.endsWith(tools)),
  t(() => s.at(p)), t(() => s.charAt(tools)), t(() => s.charCodeAt(p)), t(() => s.codePointAt(tools.git.status)),
  t(() => s.slice(1, p)), t(() => s.substring(tools)), t(() => s.substr(p)),
  t(() => s.padStart(p)), t(() => s.padStart(9, tools)), t(() => s.padEnd(1e10, p)), t(() => s.padEnd(6, p)),
  t(() => s.repeat(tools)), t(() => s.split(p)), t(() => s.split("b", tools)), t(() => s.split(undefined, p)),
  t(() => s.replace(p, "x")), t(() => s.replace("a", tools)), t(() => s.replaceAll(/a/g, p)),
  t(() => s.replaceAll(/a/, p)), t(() => s.replace(p, () => "y")),
  t(() => s.concat("x", p)), t(() => s.concat(tools)), t(() => s.localeCompare(p)), t(() => s.normalize(tools)),
  t(() => s.toUpperCase(p)), t(() => s.at(undefined)),
  t(() => s.indexOf(() => 1)), t(() => s.concat(function* g() {}, [tools], { toString: () => "!" })),
  t(() => s.includes((function* () {})())),
  t(() => String.prototype.at.call(p, 0)), t(() => String.prototype.slice.call(tools, -3)),
  t(() => s.slice({ valueOf() { throw new Error("first") } }, p)),
  t(() => String.prototype.trim.call(null)), t(() => String.prototype.toLocaleUpperCase.call(undefined)),
  t(() => String.prototype[Symbol.iterator].call(null)), t(() => String.prototype.padEnd.call(null, 2)),
]
