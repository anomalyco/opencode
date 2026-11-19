// Object.defineProperty, defineProperties, getOwnPropertyDescriptor(s), getOwnPropertyNames and Object.create with
// descriptors: data and accessor descriptors, defaults, redefinition rules, array elements and lengths, and the
// integrity checks.
const out = []
const probe = (f) => { try { out.push(f()) } catch (e) { out.push([e.name, e.message]) } }
const o = { a: 1 }
Object.defineProperty(o, "b", { value: 2 })
Object.defineProperty(o, "c", { get() { return 3 }, enumerable: true, configurable: true })
probe(() => [Object.keys(o), o.b, o.c, Object.getOwnPropertyNames(o)])
probe(() => Object.getOwnPropertyDescriptors(o))
probe(() => Object.defineProperty(o, "b", { value: 9 }))
probe(() => Object.defineProperty(o, "b", { value: 2 }) === o)
probe(() => { Object.defineProperty(o, "c", { value: 4 }); return Object.getOwnPropertyDescriptor(o, "c") })
probe(() => Object.defineProperty(o, "d", { get() {}, value: 1 }))
probe(() => Object.defineProperty(o, "d", { get: 1 }))
probe(() => Object.defineProperty(1, "d", {}))
probe(() => { const p = Object.create({}, { x: { get() { return 1 }, enumerable: true }, y: { value: 2, writable: true } }); return [p.x, p.y, Object.keys(p)] })
probe(() => { const p = {}; Object.defineProperties(p, { a: { value: 1, enumerable: true }, b: { get() { return this.a + 1 } } }); return [p.b, Object.keys(p)] })
probe(() => { const arr = [1, 2]; Object.defineProperty(arr, 0, { value: 5 }); return arr })
probe(() => Object.defineProperty([1], 0, { get() {} }))
probe(() => Object.defineProperty([1], 0, { value: 1, enumerable: false }))
probe(() => { const arr = [1, 2, 3]; Object.defineProperty(arr, "length", { value: 1 }); return arr })
probe(() => Object.defineProperty([], "length", { writable: false }))
probe(() => { function f(a, b) {} return [Object.getOwnPropertyNames(f), Object.getOwnPropertyDescriptor(f, "name")] })
probe(() => [Object.getOwnPropertyDescriptor("ab", 1), Object.getOwnPropertyNames("ab"), Object.getOwnPropertyDescriptor(Math, "PI")])
probe(() => { const d = Object.getOwnPropertyDescriptor(Map.prototype, "size"); return [d.get.name, d.set, d.get.call(new Map([[1, 2]]))] })
probe(() => Object.getOwnPropertyDescriptor(Map.prototype, "size").get.call(new Set()))
probe(() => { const s = {}; Object.defineProperty(s, "a", { value: 1 }); Object.preventExtensions(s); return [Object.isFrozen(s), Object.isSealed(s)] })
probe(() => { const s = {}; Object.defineProperty(s, "a", { get() {}, set(v) {} }); Object.preventExtensions(s); return [Object.isFrozen(s), Object.isSealed(s)] })
probe(() => Object.defineProperty(Object.freeze({}), "a", { value: 1 }))
probe(() => Object.getOwnPropertyDescriptor(undefined, "a"))
probe(() => { let read = 0; const desc = { get value() { read++; return 42 }, get enumerable() { read++; return true } }; const t = {}; Object.defineProperty(t, "a", desc); return [t.a, read, Object.keys(t)] })
return out
