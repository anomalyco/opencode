const out = []
const P = Object.prototype
const probes = [undefined, null, "abc", 5, true, [1], { a: 1 }, () => 1, new Map(), tools]
for (const name of ["hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toString", "toLocaleString", "valueOf"]) {
  for (const v of probes) {
    try { const r = P[name].call(v, name === "isPrototypeOf" ? {} : "a"); out.push([name, typeof r === "object" ? typeof r : r]) } catch (e) { out.push([name, e.name, e.message]) }
  }
}
out.push([1].hasOwnProperty(0), ({ a: 1 }).propertyIsEnumerable("a"), Object.prototype.isPrototypeOf.call(Object.prototype, []))
try { out.push(P.isPrototypeOf.call(undefined, 1)) } catch (e) { out.push(e.name, e.message) }
try { out.push(P.isPrototypeOf.call(null, {})) } catch (e) { out.push(e.name, e.message) }

for (const v of [tools, tools.echo, tools.a.b]) {
  out.push(P.toString.call(v))
  try { out.push(P.toLocaleString.call(v)) } catch (e) { out.push([e.name, e.message]) }
  try { out.push(typeof P.valueOf.call(v)) } catch (e) { out.push([e.name, e.message]) }
}
try { out.push("abc".hasOwnProperty("length")) } catch (e) { out.push([e.name, e.message]) }
try { out.push((1).propertyIsEnumerable("x")) } catch (e) { out.push([e.name, e.message]) }
const { hasOwnProperty } = Object.prototype
try { hasOwnProperty("x") } catch (e) { out.push([e.name, e.message]) }
out.push(Object.create(null) instanceof Object, Object.prototype.hasOwnProperty.call(Object.create(null), "x"))
return out
