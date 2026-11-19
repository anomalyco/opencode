import { describe, expect, test } from "bun:test"
import { runProgram } from "./run-program.js"

// The property descriptor API: Object.defineProperty(ies), getOwnPropertyDescriptor(s), getOwnPropertyNames, and
// Object.create's second argument, over plain objects, arrays, functions and built-ins.

const value = (code: string) => {
  const result = runProgram(code)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  expect(runProgram(code, { roundTrip: { every: 1, max: 20_000 } })).toEqual(result)
  return result.value
}
const error = (code: string) => {
  const result = runProgram(code)
  if (result.ok) throw new Error(`expected failure, got value ${JSON.stringify(result.value)}`)
  return result.error.message
}

describe("Object.defineProperty", () => {
  test("data properties default to false attributes, and read-only ones refuse writes", () => {
    expect(
      value(`const o = {}
        Object.defineProperty(o, "x", { value: 1 })
        let refused
        try { o.x = 2 } catch (e) { refused = e.message }
        return [o.x, Object.keys(o), refused, Object.getOwnPropertyDescriptor(o, "x")]`),
    ).toEqual([
      1,
      [],
      "Cannot assign to read only property 'x'.",
      { value: 1, writable: false, enumerable: false, configurable: false },
    ])
  })

  test("accessors from descriptors, with a getter and a setter", () => {
    expect(
      value(`const o = { _v: 1 }
        const r = Object.defineProperty(o, "v", { get() { return this._v }, set(x) { this._v = x * 2 }, enumerable: true, configurable: true })
        o.v = 5
        const d = Object.getOwnPropertyDescriptor(o, "v")
        return [r === o, o.v, typeof d.get, typeof d.set, d.enumerable, d.configurable, Object.keys(d)]`),
    ).toEqual([true, 10, "function", "function", true, true, ["get", "set", "enumerable", "configurable"]])
  })

  test("the transitions ValidateAndApplyPropertyDescriptor allows and refuses", () => {
    expect(
      value(`const o = {}
        Object.defineProperty(o, "a", { value: 1, configurable: true })
        Object.defineProperty(o, "a", { get() { return 2 } })
        const first = o.a
        Object.defineProperty(o, "a", { value: 3 })
        const d = Object.getOwnPropertyDescriptor(o, "a")
        Object.defineProperty(o, "b", { value: NaN })
        Object.defineProperty(o, "b", { value: NaN })
        Object.defineProperty(o, "c", { get() { return 1 } })
        const refusals = []
        for (const [key, desc] of [["b", { value: 1 }], ["b", { writable: true }], ["c", { value: 1 }], ["c", { get() {} }], ["c", { enumerable: true }], ["c", { configurable: true }]]) {
          try { Object.defineProperty(o, key, desc) } catch (e) { refusals.push(e.message) }
        }
        Object.defineProperty(o, "z", { value: 0, writable: true })
        Object.defineProperty(o, "z", { value: -0 })
        return [first, o.a, d.writable, d.configurable, refusals.length, Object.is(o.z, -0), refusals[0]]`),
    ).toEqual([2, 3, false, true, 6, true, "Cannot redefine property: b"])
  })

  test("a generic descriptor updates an accessor in place", () => {
    expect(
      value(`const o = { get x() { return 1 } }
        Object.defineProperty(o, "x", { enumerable: false })
        return [o.x, Object.keys(o), typeof Object.getOwnPropertyDescriptor(o, "x").get]`),
    ).toEqual([1, [], "function"])
  })

  test("descriptor objects are read through getters and the prototype chain", () => {
    expect(
      value(`const log = []
        const desc = Object.create({ get value() { log.push("value"); return 7 } })
        Object.defineProperty(desc, "enumerable", { get() { log.push("enumerable"); return true } })
        const o = Object.defineProperty({}, "x", desc)
        return [o.x, Object.keys(o), log]`),
    ).toEqual([7, ["x"], ["enumerable", "value"]])
  })

  test("bad descriptors and targets are TypeErrors", () => {
    expect(error(`Object.defineProperty({}, "x", 1)`)).toContain("Property description must be an object")
    expect(error(`Object.defineProperty({}, "x", { get: 1 })`)).toContain("Getter must be a function")
    expect(error(`Object.defineProperty({}, "x", { get() {}, value: 1 })`)).toContain("Cannot both specify accessors")
    expect(error(`Object.defineProperty(1, "x", {})`)).toContain("Object.defineProperty called on non-object")
    expect(error(`Object.defineProperty(Object.preventExtensions({}), "x", { value: 1 })`)).toContain(
      "object is not extensible",
    )
  })

  test("frozen and sealed objects keep their accessors, and setters still run", () => {
    expect(
      value(`const o = Object.freeze({ n: 1, get x() { return this.n }, set x(v) { log.push(v) } })
        const log = []
        o.x = 5
        return [o.x, log, Object.isFrozen(o), Object.getOwnPropertyDescriptor(o, "x").configurable]`),
    ).toEqual([1, [5], true, false])
  })
})

describe("arrays", () => {
  test("elements take only the array's shared attributes, never accessors", () => {
    expect(error(`Object.defineProperty([1], 0, { get() { return 1 } })`)).toContain(
      "Accessor properties are not supported on array elements",
    )
    expect(error(`Object.defineProperty([1], 0, { value: 2, writable: false })`)).toContain(
      "Array elements share their attributes",
    )
    expect(
      value(`const a = [1, 2]
        Object.defineProperty(a, 0, { value: 9 })
        Object.defineProperty(a, 2, { value: 3, writable: true, enumerable: true, configurable: true })
        Object.defineProperty(a, "length", { value: 2 })
        Object.defineProperty(a, "extra", { get() { return this.length } })
        return [a, a.extra]`),
    ).toEqual([[9, 2], 2])
  })

  test("a frozen array refuses new values and keeps its elements", () => {
    expect(error(`Object.defineProperty(Object.freeze([10]), 0, { value: 99 })`)).toContain(
      "Cannot redefine property: 0",
    )
    expect(error(`Object.defineProperty(Object.freeze([10]), "length", { value: 5 })`)).toContain(
      "Cannot redefine property",
    )
    expect(value(`const a = Object.freeze([10]); Object.defineProperty(a, 0, { value: 10 }); return a`)).toEqual([10])
    expect(error(`Object.defineProperty([1], "length", { writable: false })`)).toContain(
      "Making an array's length read-only",
    )
  })
})

describe("reading descriptors and names", () => {
  test("getOwnPropertyDescriptor(s) and getOwnPropertyNames", () => {
    expect(
      value(`function f(a, b) {}
        return [
          Object.getOwnPropertyNames({ b: 1, a: 2, 1: 3 }),
          Object.getOwnPropertyNames([5]),
          Object.getOwnPropertyNames(f),
          Object.getOwnPropertyNames("ab"),
          Object.getOwnPropertyDescriptor("ab", 1),
          Object.getOwnPropertyDescriptor("ab", "length"),
          Object.getOwnPropertyDescriptor(1, "x"),
          Object.keys(Object.getOwnPropertyDescriptors({ a: 1, get b() { return 2 } })),
          Object.getOwnPropertyDescriptor([7], 0),
        ]`),
    ).toEqual([
      ["1", "b", "a"],
      ["0", "length"],
      ["length", "name"],
      ["0", "1", "length"],
      { value: "b", writable: false, enumerable: true, configurable: false },
      { value: 2, writable: false, enumerable: false, configurable: false },
      null,
      ["a", "b"],
      { value: 7, writable: true, enumerable: true, configurable: true },
    ])
    expect(error(`Object.getOwnPropertyDescriptor(null, "x")`)).toContain("cannot convert null")
  })

  test("built-in accessors show as callable companion functions", () => {
    expect(
      value(`const d = Object.getOwnPropertyDescriptor(Map.prototype, "size")
        let refused
        try { d.get.call({}) } catch (e) { refused = e instanceof TypeError }
        Object.defineProperty(Map.prototype, "size", d)
        const r = Object.getOwnPropertyDescriptor(RegExp.prototype, "lastIndex")
        return [d.get.name, d.get.call(new Map([[1, 2]])), d.set, refused, new Map([[1, 1], [2, 2]]).size, typeof r]`),
    ).toEqual(["get size", 1, null, true, 2, "object"])
  })

  test("a built-in accessor copied to a plain object, and a mixed native and program slot", () => {
    expect(
      value(`const o = {}
        Object.defineProperty(o, "flags", Object.getOwnPropertyDescriptor(RegExp.prototype, "flags"))
        const u = new URL("https://a.test/x")
        Object.defineProperty(URL.prototype, "pathname", { set(v) { log.push(v) } })
        const log = []
        u.pathname = "/y"
        const d = Object.getOwnPropertyDescriptor(URL.prototype, "pathname")
        return [typeof Object.getOwnPropertyDescriptor(o, "flags").get, u.pathname, log, typeof d.get, typeof d.set]`),
    ).toEqual(["function", "/x", ["/y"], "function", "function"])
  })

  test("built-ins' own properties follow the usual rules", () => {
    expect(error(`Object.defineProperty(Math, "PI", { value: 3 })`)).toContain("Cannot redefine property: PI")
    expect(value(`function f() {}; Object.defineProperty(f, "name", { value: "g" }); return f.name`)).toBe("g")
    expect(
      value(`Object.defineProperty(String.prototype, "first", { get() { return this[0] }, configurable: true })
        Object.defineProperty(Number.prototype, "double", { get() { return this * 2 }, set(v) { log.push(v) }, configurable: true })
        const log = []
        ;(5).double = 1
        return ["abc".first, (4).double, log]`),
    ).toEqual(["a", 8, [1]])
  })
})

describe("Object.create and defineProperties", () => {
  test("Object.create takes descriptors, and defineProperties reads them all before defining", () => {
    expect(
      value(`const log = []
        const o = Object.create({ inherited: 1 }, { a: { value: 1, enumerable: true }, b: { get() { return 2 } } })
        const t = {}
        try {
          Object.defineProperties(t, { x: { value: 1 }, y: { get value() { log.push("y"); return 2 } }, z: 5 })
        } catch (e) { log.push(e.message) }
        return [o.a, o.b, o.inherited, Object.keys(o), Object.getOwnPropertyNames(t), log]`),
    ).toEqual([1, 2, 1, ["a"], [], ["y", "Property description must be an object: a number"]])
  })

  test("defineProperties fails after the earlier ones are defined", () => {
    expect(
      value(`const t = Object.defineProperty({}, "b", { value: 1 })
        try { Object.defineProperties(t, { a: { value: 1 }, b: { value: 2 } }) } catch (e) {}
        return Object.getOwnPropertyNames(t)`),
    ).toEqual(["b", "a"])
  })
})

describe("defineProperty edge cases", () => {
  test("a refused length define leaves length alone, and a frozen array's length cannot change", () => {
    expect(
      value(`const a = [1]
        let refused
        try { Object.defineProperty(a, "length", { value: 5, writable: false }) } catch (e) { refused = e.message }
        const f = Object.freeze([1])
        let frozen
        try { Object.defineProperty(f, "length", { value: 5 }) } catch (e) { frozen = e.message }
        return [a.length, refused, f.length, frozen]`),
    ).toEqual([
      1,
      "Making an array's length read-only is not supported; use Object.freeze.",
      1,
      "Cannot redefine property: length",
    ])
  })

  test("a Uint8Array index past the end is refused", () => {
    expect(
      error(
        `Object.defineProperty(new Uint8Array(2), 5, { value: 99, writable: true, enumerable: true, configurable: true })`,
      ),
    ).toBe("TypeError: Cannot redefine property: 5 (line 1, col 1)")
  })

  test("defineProperties converts its argument with ToObject", () => {
    expect(error(`Object.defineProperties({}, "ab")`)).toBe(
      "TypeError: Property description must be an object: a string (line 1, col 1)",
    )
    expect(value(`return [Object.defineProperties({ a: 1 }, 5), Object.defineProperties({ b: 2 }, true)]`)).toEqual([
      { a: 1 },
      { b: 2 },
    ])
    expect(error(`Object.defineProperties({}, null)`)).toBe("TypeError: Cannot convert null to object (line 1, col 1)")
  })

  test("defining a value refuses a cycle the way an assignment does", () => {
    const assigned = error(`const a = {}; a.self = a`)
    expect(error(`const a = {}; Object.defineProperty(a, "self", { value: a })`)).toBe(assigned)
  })
})
