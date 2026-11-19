// The own property names of every built-in constructor and prototype, in order (Object.getOwnPropertyNames).
const out = {}
const seen = new Set()
const visit = (label, o) => {
  if (o === null || (typeof o !== "object" && typeof o !== "function") || seen.has(o)) return
  seen.add(o)
  let keys
  try { keys = Object.getOwnPropertyNames(o) } catch (e) { return }
  out[label] = keys.join(",")
  for (const k of keys) {
    let d
    try { d = Object.getOwnPropertyDescriptor(o, k) } catch (e) { continue }
    if (d && "value" in d && (typeof d.value === "function" || (typeof d.value === "object" && d.value !== null)) && (k === "prototype" || /^[A-Z]/.test(k) || label === "globalThis")) visit(label + "." + k, d.value)
  }
  try { visit(label + ".__proto__", Object.getPrototypeOf(o)) } catch (e) {}
}
try { visit("Buffer", Buffer) } catch (e) {}
try { visit("TextEncoder", TextEncoder) } catch (e) {}
try { visit("TextDecoder", TextDecoder) } catch (e) {}
try { visit("Map", Map) } catch (e) {}
try { visit("Set", Set) } catch (e) {}
try { visit("Object", Object) } catch (e) {}
try { visit("WeakMap", WeakMap) } catch (e) {}
try { visit("URL", URL) } catch (e) {}
try { visit("URLSearchParams", URLSearchParams) } catch (e) {}
try { visit("Object", Object) } catch (e) {}
try { visit("Function", Function) } catch (e) {}
try { visit("Array", Array) } catch (e) {}
try { visit("String", String) } catch (e) {}
try { visit("Number", Number) } catch (e) {}
try { visit("Boolean", Boolean) } catch (e) {}
try { visit("Symbol", Symbol) } catch (e) {}
try { visit("Math", Math) } catch (e) {}
try { visit("JSON", JSON) } catch (e) {}
try { visit("Promise", Promise) } catch (e) {}
try { visit("Map", Map) } catch (e) {}
try { visit("Set", Set) } catch (e) {}
try { visit("Error", Error) } catch (e) {}
try { visit("TypeError", TypeError) } catch (e) {}
try { visit("RangeError", RangeError) } catch (e) {}
try { visit("SyntaxError", SyntaxError) } catch (e) {}
try { visit("ReferenceError", ReferenceError) } catch (e) {}
try { visit("EvalError", EvalError) } catch (e) {}
try { visit("URIError", URIError) } catch (e) {}
try { visit("AggregateError", AggregateError) } catch (e) {}
try { visit("RegExp", RegExp) } catch (e) {}
try { visit("Date", Date) } catch (e) {}
try { visit("Buffer", Buffer) } catch (e) {}
try { visit("WeakMap", WeakMap) } catch (e) {}
try { visit("WeakSet", WeakSet) } catch (e) {}
try { visit("Iterator", Iterator) } catch (e) {}
try { visit("URL", URL) } catch (e) {}
try { visit("URLSearchParams", URLSearchParams) } catch (e) {}
try { visit("Headers", Headers) } catch (e) {}
try { visit("TextEncoder", TextEncoder) } catch (e) {}
try { visit("TextDecoder", TextDecoder) } catch (e) {}
try { visit("console", console) } catch (e) {}
try { visit("NaN", NaN) } catch (e) {}
try { visit("Infinity", Infinity) } catch (e) {}
try { visit("NaN", NaN) } catch (e) {}
try { visit("Infinity", Infinity) } catch (e) {}
for (const [l, x] of [["iter", [][Symbol.iterator]()], ["gen", (function* () {})()], ["agen", (async function* () {})()], ["gf", function* () {}], ["agf", async function* () {}], ["af", async function () {}], ["miter", new Map().entries()], ["siter", ""[Symbol.iterator]()], ["helper", [1].values().map((x) => x)]]) visit(l, Object.getPrototypeOf(x))
return out
