const out = []
const probe = (label, f) => {
  const r = [label, f.hasOwnProperty("length"), f.hasOwnProperty("name")]
  try { r.push(delete f.length) } catch (e) { r.push("E " + e.message) }
  r.push(f.hasOwnProperty("length"), f.length)
  try { r.push(delete f.name) } catch (e) { r.push("E " + e.message) }
  r.push(f.hasOwnProperty("name"), JSON.stringify(f.name))
  try { f.length = 9; r.push(f.length) } catch (e) { r.push("E " + e.message) }
  r.push(Object.keys(f).join(","))
  out.push(r.join(" | "))
}
probe("native", String.prototype.charAt)
probe("uri", encodeURI)
function g(a, b) {}
probe("closure", g)
probe("arrow", (a) => a)
probe("bound", g.bind(null, 1))
probe("ctor", Map)
function g3(a, b, c) {}
const b1 = g3.bind(null, 1), b2 = b1.bind(null, 2, 3, 4), b3 = Math.max.bind(null)
out.push(b1.length, b1.name, b2.length, b2.name, b3.length, b3.name, (() => 1).bind().name)
return out
