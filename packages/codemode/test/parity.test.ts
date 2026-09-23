import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../src/index.js"

// Runs a CodeMode program with no host tools and returns the CodeMode.Result. These tests pin the
// JS-parity behaviors for the "99% of ordinary defensive JavaScript just works" goal: cases where
// a strict interpreter would throw but idiomatic JS yields undefined / succeeds.
//
// Note on the result boundary: this package normalizes a bare `undefined` result to `null` when
// it crosses out of CodeMode (results are JSON data), so tests asserting an in-CodeMode
// `undefined` read check `=== undefined` inside the program and `null` at the boundary.
const run = (code: string) => Effect.runPromise(CodeMode.execute({ code, tools: {} }))
const value = async (code: string) => {
  const result = await run(code)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}
const error = async (code: string) => {
  const result = await run(code)
  if (result.ok) throw new Error(`expected failure, got value ${JSON.stringify(result.value)}`)
  return result.error
}

describe("H2: string property access reads as undefined (not a throw)", () => {
  test("unknown property on a string is undefined", async () => {
    expect(await value(`const s = "hi"; return s.login === undefined`)).toBe(true)
    expect(await value(`const s = "hi"; return s.login`)).toBeNull()
  })

  test("optional chaining + fallback on a string does not throw", async () => {
    expect(await value(`const s = "hi"; return s?.login ?? "fallback"`)).toBe("fallback")
  })

  test("the real MCP pattern: result is a JSON string, defensive read falls through", async () => {
    // me.result is a string; me.result?.login is undefined, so we fall back to the raw string.
    expect(await value(`const me = { result: '{"login":"x"}' }; return me.result?.login ?? me.result`)).toBe(
      '{"login":"x"}',
    )
  })

  test("unknown property on a number is undefined", async () => {
    expect(await value(`return (5).foo ?? "n"`)).toBe("n")
  })

  test("only canonical string index keys access characters", async () => {
    expect(
      await value(`
        const text = "abc"
        return [text[1], text["1"], text["01"], text["1.0"], text[-0], text["-0"]]
      `),
    ).toEqual(["b", "b", null, null, "a", null])
  })
})

describe("H3: array property access reads as undefined (not a throw)", () => {
  test("unknown property on an array is undefined", async () => {
    expect(await value(`return [1,2,3].foo === undefined`)).toBe(true)
    expect(await value(`return [1,2,3].foo`)).toBeNull()
  })

  test("optional chaining on an array does not throw", async () => {
    expect(await value(`return [1,2,3]?.foo ?? "fb"`)).toBe("fb")
  })

  test("unknown property reads stay undefined for methods CodeMode does not implement", async () => {
    expect(await value(`return [1,2,3].unknownMethod === undefined`)).toBe(true)
  })

  test("array indexing still works", async () => {
    expect(await value(`return [1,2,3][9] === undefined`)).toBe(true)
    expect(await value(`return [1,2,3][9]`)).toBeNull()
  })

  test("only canonical array index keys access elements", async () => {
    expect(
      await value(`
        const values = ["a", "b"]
        return [values[1], values["1"], values["01"], values["1.0"], values[-0], values["-0"]]
      `),
    ).toEqual(["b", "b", null, null, "a", null])
  })

  test("noncanonical keys are ordinary properties that never alias an element", async () => {
    expect(
      await value(`
        const values = ["a", "b"]
        values["01"] = "c"
        const before = [values["01"], values[1], values.length]
        const removed = delete values["01"]
        return [before, removed, values["01"], values]
      `),
    ).toEqual([["c", "b", 2], true, null, ["a", "b"]])
  })

  test("the maximum array length is a property, not an index", async () => {
    expect(
      await value(`
        const values = []
        values["4294967295"] = 1
        return [values["4294967295"], values.length]
      `),
    ).toEqual([1, 0])
  })
})

describe("H6: object spread of null/undefined is a no-op", () => {
  test("spreading null is a no-op", async () => {
    expect(await value(`const o = null; return { ...o, a: 1 }`)).toEqual({ a: 1 })
  })

  test("spreading an absent argument merges cleanly", async () => {
    expect(await value(`function f(opts){ return { ...opts, a: 1 } } return f(undefined)`)).toEqual({ a: 1 })
  })

  test("spreading a real object still works", async () => {
    expect(await value(`const o = { a: 1 }; return { ...o, b: 2 }`)).toEqual({ a: 1, b: 2 })
  })

  test("spreading an array or string into an object copies index keys, like JS", async () => {
    expect(await value(`return { ...[1,2], a: 1 }`)).toEqual({ 0: 1, 1: 2, a: 1 })
    expect(await value(`return { ..."ab", ...5, ...true, ...(() => 1), ...new Map([[1, 2]]) }`)).toEqual({
      0: "a",
      1: "b",
    })
  })
})

describe("H4: typeof on an undeclared identifier is 'undefined'", () => {
  test("feature-detection guard does not throw", async () => {
    expect(await value(`return typeof foo === "undefined" ? "safe" : "no"`)).toBe("safe")
  })

  test("typeof of a declared binding is unaffected", async () => {
    expect(await value(`const x = 5; return typeof x`)).toBe("number")
    expect(await value(`const s = "a"; return typeof s`)).toBe("string")
  })

  test("referencing an undeclared identifier outside typeof still throws", async () => {
    const err = await error(`return foo + 1`)
    expect(err.message).toContain("foo")
  })
})

describe("CodeMode lexical scope integration", () => {
  test("keeps self, cross, and destructuring defaults in the TDZ", async () => {
    expect(
      await value(`
        const outer = 1
        const errors = []
        try { const first = second, second = 2 } catch (error) { errors.push(error.name) }
        try { const [first = second, second = 2] = [] } catch (error) { errors.push(error.name) }
        return errors
      `),
    ).toEqual(["ReferenceError", "ReferenceError"])
  })

  test("keeps typeof and constant assignment inside the TDZ", async () => {
    expect(
      await value(`
        const errors = []
        try { { errors.push(typeof item); let item } } catch (error) { errors.push(error.name) }
        try { { constant = 1; const constant = 2 } } catch (error) { errors.push(error.name) }
        return errors
      `),
    ).toEqual(["ReferenceError", "ReferenceError"])
  })

  test("shadows builtins from the start of the program scope", async () => {
    expect(
      await value(`
        let observed
        try { observed = typeof Promise } catch (error) { observed = error.name }
        const Promise = 1
        return observed
      `),
    ).toBe("ReferenceError")
  })

  test("keeps classic for initializers inside the header TDZ", async () => {
    expect(
      await value(`
        let index = 1
        try { for (let index = index; index < 2; index++) {} } catch (error) { return error.name }
      `),
    ).toBe("ReferenceError")
  })

  test("removes loop scopes when per-iteration initialization fails", async () => {
    expect(
      await value(`
        const value = "outer"
        try { for (let [value] of [1]) {} } catch {}
        return value
      `),
    ).toBe("outer")
  })
})

describe("unary void", () => {
  test("evaluates its operand and returns undefined", async () => {
    expect(
      await value(`let count = 0; const result = void (count += 1); return [count, result === undefined]`),
    ).toEqual([1, true])
  })

  test("discards opaque values", async () => {
    expect(await value(`return void tools === undefined`)).toBe(true)
  })
})

describe("property deletion", () => {
  test("deletes plain object fields and reports missing fields as successful", async () => {
    expect(
      await value(`
        const object = { keep: 1, remove: 2 }
        return [delete object.remove, delete object.missing, object]
      `),
    ).toEqual([true, true, { keep: 1 }])
  })

  test("a non-reference operand is evaluated and the result is true; a variable cannot be deleted", async () => {
    expect(
      await value(`
        let called = false
        const results = [delete 0, delete null, delete { x: 1 }, delete void 0, delete (() => { called = true })()]
        let variable = 1
        let failure
        try { delete variable } catch (error) { failure = error.constructor.name }
        return [results, called, failure]
      `),
    ).toEqual([[true, true, true, true, true], true, "TypeError"])
  })

  test("evaluates computed object and key expressions once", async () => {
    expect(
      await value(`
        const object = { remove: true }
        let objectReads = 0
        let keyReads = 0
        function getObject() { objectReads++; return object }
        function getKey() { keyReads++; return "remove" }
        const removed = delete getObject()[getKey()]
        return [removed, objectReads, keyReads, Object.hasOwn(object, "remove")]
      `),
    ).toEqual([true, 1, 1, false])
  })

  test("deleting an array index creates a hole without changing its length", async () => {
    expect(
      await value(
        `const values = [1, 2, 3]; const removed = delete values[1]; return [removed, values.length, 1 in values, values]`,
      ),
    ).toEqual([true, 3, false, [1, null, 3]])
  })

  test("array length is not configurable", async () => {
    expect((await error(`const values = [1, 2]; delete values.length`)).message).toContain(
      "Cannot delete property 'length'",
    )
  })

  test("arrays accept named properties like JS, and they stay out of the JSON form", async () => {
    expect(
      await value(`
        const values = [1]
        values.field = 2
        return [values.field, Object.keys(values), values]
      `),
    ).toEqual([2, ["0", "field"], [1]])
  })

  test("optional deletion short-circuits without evaluating the key", async () => {
    expect(
      await value(`let keyReads = 0; const object = null; return [delete object?.[keyReads++], keyReads]`),
    ).toEqual([true, 0])
  })

  test("rejects deletion from opaque runtime references", async () => {
    expect((await error(`return delete tools.example`)).kind).toBe("InvalidDataValue")
  })

  test("prototype-named keys delete like any own data key", async () => {
    expect(
      await value(`const object = { __proto__: 1, a: 2 }; delete object.__proto__; return Object.keys(object)`),
    ).toEqual(["a"])
    expect(await value(`const values = [1]; delete values["constructor"]; return values`)).toEqual([1])
  })
})

describe("H1: NaN/Infinity flow as intermediates and normalize to null at the boundary", () => {
  test("guards run instead of the program crashing on a transient NaN", async () => {
    expect(await value(`return parseInt("abc") || 0`)).toBe(0)
    expect(await value(`const x = Number("abc"); return Number.isNaN(x) ? 0 : x`)).toBe(0)
    expect(await value(`const o = {}; o.count = (o.count || 0) + 1; return o.count`)).toBe(1)
    // average of an empty list, guarded - the classic divide-by-zero that used to throw pre-guard
    expect(await value(`const a = []; return a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0`)).toBe(0)
  })

  test("a non-finite value becomes null when it leaves CodeMode", async () => {
    expect(await value(`return 5/0`)).toBeNull()
    expect(await value(`return 0/0`)).toBeNull()
    expect(await value(`return Math.max()`)).toBeNull()
    // nested, too - normalization walks the returned structure
    expect(await value(`return { a: Number("x"), b: 2, c: [1/0] }`)).toEqual({ a: null, b: 2, c: [null] })
  })

  test("NaN and Infinity are usable identifiers and inspectable in-CodeMode", async () => {
    expect(await value(`return Number.isNaN(NaN)`)).toBe(true)
    expect(await value(`return Infinity > 1e9`)).toBe(true)
    expect(await value(`return Number.isFinite(1/0)`)).toBe(false)
    expect(await value(`return [3,1,2].reduce((a,b)=>Math.max(a,b), -Infinity)`)).toBe(3)
    // JSON.stringify inside CodeMode matches JS: non-finite serializes to null
    expect(await value(`return JSON.stringify({ x: Number("z") })`)).toBe('{"x":null}')
  })

  test("the boundary normalizes non-finite numbers to null like JSON.stringify", async () => {
    expect(await value(`return { a: Number("z"), b: [Infinity, -Infinity, 1] }`)).toEqual({
      a: null,
      b: [null, null, 1],
    })
  })
})

describe("undefined at the boundary", () => {
  test("vanishes like JSON.stringify", async () => {
    expect(await value(`return { q: undefined, keep: 1, nested: { a: undefined, b: [undefined] } }`)).toStrictEqual({
      keep: 1,
      nested: { b: [null] },
    })
    expect(await value(`return [1, undefined, 2]`)).toStrictEqual([1, null, 2])
    expect(await value(`return undefined`)).toBeNull()
  })
})

describe("Error values and instanceof", () => {
  test("new Error carries name/message and is instanceof Error", async () => {
    expect(await value(`const e = new Error("boom"); return [e instanceof Error, e.name, e.message]`)).toEqual([
      true,
      "Error",
      "boom",
    ])
  })

  test("Error without new behaves like new Error", async () => {
    expect(await value(`const e = Error("plain"); return [e instanceof Error, e.name, e.message]`)).toEqual([
      true,
      "Error",
      "plain",
    ])
    expect(await value(`const e = new Error(); return [e.name, e.message, e instanceof Error]`)).toEqual([
      "Error",
      "",
      true,
    ])
  })

  test("specific error types are instanceof themselves and Error, not each other", async () => {
    expect(
      await value(
        `const e = new TypeError("t"); return [e instanceof TypeError, e instanceof Error, e instanceof RangeError]`,
      ),
    ).toEqual([true, true, false])
    expect(await value(`return new Error("e") instanceof TypeError`)).toBe(false)
  })

  test("new Error(message, { cause }) installs a non-enumerable cause only when the option is present", async () => {
    expect(
      await value(`
        const inner = new Error("root")
        const e = new TypeError("m", { cause: inner })
        const agg = new AggregateError([], "a", { cause: 3 })
        return [e.cause === inner, Object.keys(e), "cause" in new Error("m"), "cause" in new Error("m", { cause: undefined }), agg.cause]`),
    ).toEqual([true, [], false, true, 3])
  })

  test("thrown errors keep instanceof through try/catch", async () => {
    expect(await value(`try { throw new Error("x") } catch (e) { return [e instanceof Error, e.message] }`)).toEqual([
      true,
      "x",
    ])
  })

  test("interpreter runtime failures are caught as Error values", async () => {
    expect(await value(`try { JSON.parse("nope") } catch (e) { return e instanceof Error }`)).toBe(true)
    expect(await value(`try { undeclared() } catch (e) { return e instanceof Error }`)).toBe(true)
  })

  test("caught failures carry the constructor name the real-JS failure would have", async () => {
    // JSON.parse throws SyntaxError: name and specific-instanceof both carry through, and the
    // message keeps the engine's position detail.
    expect(
      await value(`
      try { JSON.parse("{oops") } catch (e) {
        return [e.name, e instanceof SyntaxError, e instanceof Error, e instanceof TypeError, e.message.includes("JSON")]
      }
    `),
    ).toEqual(["SyntaxError", true, true, false, true])
    expect(await value(`try { undeclared() } catch (e) { return [e.name, e instanceof ReferenceError] }`)).toEqual([
      "ReferenceError",
      true,
    ])
    expect(await value(`try { const c = 1; c = 2 } catch (e) { return [e.name, e instanceof TypeError] }`)).toEqual([
      "TypeError",
      true,
    ])
    expect(await value(`try { "a".match("(") } catch (e) { return [e.name, e instanceof SyntaxError] }`)).toEqual([
      "SyntaxError",
      true,
    ])
    expect(await value(`try { new RegExp("(") } catch (e) { return [e.name, e instanceof SyntaxError] }`)).toEqual([
      "SyntaxError",
      true,
    ])
  })

  test("interpreter failures are TypeErrors; unsupported syntax is a SyntaxError", async () => {
    expect(await value(`try { null.x } catch (e) { return [e.name, e instanceof TypeError] }`)).toEqual([
      "TypeError",
      true,
    ])
    expect(await value(`try { tools + 1 } catch (e) { return e.name }`)).toBe("TypeError")
    expect(await value(`try { class A {} } catch (e) { return [e.name, e instanceof SyntaxError] }`)).toEqual([
      "SyntaxError",
      true,
    ])
  })

  test("errors inherit constructor and instanceof through a real prototype chain", async () => {
    expect(
      await value(`
        const { constructor } = new RangeError("r")
        let caught
        try { const { a } = null } catch (e) { caught = e }
        return [
          constructor === RangeError,
          new RangeError("r") instanceof Error,
          new RangeError("r") instanceof TypeError,
          caught.constructor === TypeError,
          ({ ...caught }).constructor === Object,
          "constructor" in caught,
          Object.keys(new RangeError("r")),
        ]
      `),
    ).toEqual([true, true, false, true, true, true, []])
  })

  test("Promise.allSettled rejection reasons are Error values", async () => {
    expect(
      await value(`
      const settled = await Promise.allSettled([Promise.reject(new Error("b"))])
      return [settled[0].reason instanceof Error, settled[0].reason.message]
    `),
    ).toEqual([true, "b"])
  })

  test("non-error thrown values are not instanceof Error", async () => {
    expect(await value(`try { throw "raw" } catch (e) { return e instanceof Error }`)).toBe(false)
    expect(await value(`try { throw { message: "shaped" } } catch (e) { return e instanceof Error }`)).toBe(false)
  })

  test("plain data is never instanceof Error", async () => {
    expect(await value(`return [({}) instanceof Error, "s" instanceof Error, null instanceof Error]`)).toEqual([
      false,
      false,
      false,
    ])
  })

  test("errors serialize as { name, message } by brand; neither is enumerable", async () => {
    expect(await value(`return new Error("m")`)).toEqual({ name: "Error", message: "m" })
    expect(await value(`return JSON.stringify(new Error("m"))`)).toBe('{"name":"Error","message":"m"}')
    expect(
      await value(
        `try { throw new Error("m") } catch (e) { return [Object.keys(e), e.name, e.hasOwnProperty("message")] }`,
      ),
    ).toEqual([[], "Error", true])
    expect(await value(`return new Error().hasOwnProperty("message")`)).toBe(false)
  })

  test("spreading an error loses the brand, like losing the prototype in JS", async () => {
    expect(await value(`const e = new Error("m"); return ({ ...e }) instanceof Error`)).toBe(false)
    expect(await value(`const e = new Error("m"); return { ...e }`)).toEqual({})
  })

  test("typeof Error is function; an unknown instanceof right-hand side is a catchable error", async () => {
    expect(await value(`return typeof Error`)).toBe("function")
    expect(await value(`try { return 1 instanceof 5 } catch (e) { return "caught" }`)).toBe("caught")
    const err = await error(`return 1 instanceof 5`)
    expect(err.message).toContain("right-hand side of 'instanceof'")
  })
})

describe("CodeMode-specific array behavior", () => {
  test("sort with a comparator mutates and returns the receiver", async () => {
    expect(
      await value(`
        const input = [3, 1, 2]
        const result = input.sort((a, b) => a - b)
        return { input, same: input === result }
      `),
    ).toEqual({ input: [1, 2, 3], same: true })
  })

  test("splice can replace and insert elements", async () => {
    expect(await value(`const a = ["a","d"]; a.splice(1, 0, "b", "c"); return a`)).toEqual(["a", "b", "c", "d"])
    expect(await value(`const a = [1,2,3]; const removed = a.splice(1, 1, "x"); return { removed, a }`)).toEqual({
      removed: [2],
      a: [1, "x", 3],
    })
  })

  test("splice rejects inserting a container into itself", async () => {
    const err = await error(`const a = [1]; a.splice(0, 0, [a]); return a`)
    expect(err.kind).toBe("InvalidDataValue")
    expect(err.message).toContain("circular")
  })

  test("indexOf and lastIndexOf with no argument search for undefined", async () => {
    expect(await value(`return [1, undefined, 3].indexOf()`)).toBe(1)
    expect(await value(`return [1, undefined, 3].lastIndexOf()`)).toBe(1)
    expect(await value(`return [1, 2, 3].indexOf()`)).toBe(-1)
  })

  test("keys/values/entries return iterators usable with for...of and spread", async () => {
    expect(await value(`return [...["x","y","z"].keys()]`)).toEqual([0, 1, 2])
    expect(await value(`return [...["x","y"].values()]`)).toEqual(["x", "y"])
    expect(
      await value(`
      const out = []
      for (const [index, item] of ["a","b"].entries()) out.push(index + ":" + item)
      return out
    `),
    ).toEqual(["0:a", "1:b"])
    expect(await value(`return [...[7].entries()]`)).toEqual([[0, 7]])
  })
})

describe("CodeMode-specific string behavior", () => {
  test("localeCompare orders strings for sorting", async () => {
    expect(await value(`return ["b","a","c"].sort((x, y) => x.localeCompare(y))`)).toEqual(["a", "b", "c"])
  })

  test("an invalid normalize form is a clear catchable error", async () => {
    expect(await value(`try { "x".normalize("nope"); return "no" } catch (e) { return e.message }`)).toContain('"NFC"')
  })

  test("exposes the Annex B string aliases every engine ships", async () => {
    expect(await value(`return [" x ".trimLeft(), " x ".trimRight(), "abc".substr(1, 1)]`)).toEqual(["x ", " x", "b"])
  })
})

describe("compound assignment matches its binary operator", () => {
  // `x op= y` must behave exactly like `x = x op y`, sharing the binary operator's coercion
  // semantics (Dates string-coerce for `+` and use their time value for arithmetic; data
  // objects/arrays coerce to their JS string form).
  const pair = async (compound: string, expanded: string) => {
    const [a, b] = await Promise.all([value(compound), value(expanded)])
    expect(a).toEqual(b)
    return a
  }

  test("CodeMode Date += concatenates its string form, like d = d + 1", async () => {
    const result = await pair(`let d = new Date(1000); d += 1; return d`, `let d = new Date(1000); d = d + 1; return d`)
    expect(result).toBe("1970-01-01T00:00:01.000Z1")
  })

  test("CodeMode Date numeric compound ops use its time value", async () => {
    expect(
      await pair(`let d = new Date(1000); d -= 400; return d`, `let d = new Date(1000); d = d - 400; return d`),
    ).toBe(600)
    expect(await pair(`let d = new Date(1000); d /= 4; return d`, `let d = new Date(1000); d = d / 4; return d`)).toBe(
      250,
    )
  })

  test("string += object/array matches x = x + obj", async () => {
    expect(await pair(`let x = "a"; x += { b: 1 }; return x`, `let x = "a"; x = x + { b: 1 }; return x`)).toBe(
      "a[object Object]",
    )
    expect(await pair(`let x = "a"; x += [1, 2]; return x`, `let x = "a"; x = x + [1, 2]; return x`)).toBe("a1,2")
  })

  test("compound assignment through a member target coerces the same way", async () => {
    expect(
      await pair(
        `const o = { s: "t" }; o.s += new Date(0); return o.s`,
        `const o = { s: "t" }; o.s = o.s + new Date(0); return o.s`,
      ),
    ).toBe("t1970-01-01T00:00:00.000Z")
  })

  test("numeric and string compound operators sweep identically to their expansions", async () => {
    const cases: Array<[string, number | string]> = [
      [`let x = 7; x += 3; return x`, 7 + 3],
      [`let x = 7; x -= 3; return x`, 7 - 3],
      [`let x = 7; x *= 3; return x`, 7 * 3],
      [`let x = 7; x /= 2; return x`, 7 / 2],
      [`let x = 7; x %= 3; return x`, 7 % 3],
      [`let x = 7; x **= 2; return x`, 7 ** 2],
      [`let x = 7; x &= 3; return x`, 7 & 3],
      [`let x = 7; x |= 8; return x`, 7 | 8],
      [`let x = 7; x ^= 2; return x`, 7 ^ 2],
      [`let x = 7; x <<= 2; return x`, 7 << 2],
      [`let x = -7; x >>= 1; return x`, -7 >> 1],
      [`let x = -7; x >>>= 1; return x`, -7 >>> 1],
      [`let x = "a"; x += "b"; return x`, "ab"],
    ]
    for (const [compound, expected] of cases) {
      expect(await value(compound)).toBe(expected)
      expect(await value(compound.replace(/x (\S+)= /, (_, op) => `x = x ${op} `))).toBe(expected)
    }
  })
})

describe("H5: builtin coercion functions work as array callbacks", () => {
  test("filter(Boolean) drops falsy values", async () => {
    expect(await value(`return [0, 1, "", 2, null, 3].filter(Boolean)`)).toEqual([1, 2, 3])
  })

  test("map(String) coerces each element", async () => {
    expect(await value(`return [1, 2, 3].map(String)`)).toEqual(["1", "2", "3"])
  })

  test("a non-callable callback is still rejected", async () => {
    const err = await error(`return [1,2,3].map(42)`)
    expect(err.message).toContain("callback")
  })
})

describe("for...of assignment destructuring", () => {
  test("assigns entry pairs into predeclared variables", async () => {
    expect(
      await value(`
      let key
      let item
      const out = []
      for ([key, item] of Object.entries({ a: 1, b: 2 })) out.push(key + item)
      return { key, item, out }
    `),
    ).toEqual({ key: "b", item: 2, out: ["a1", "b2"] })
  })

  test("assigns object patterns and defaults", async () => {
    expect(
      await value(`
      let id
      let label
      const labels = []
      for ({ id, label = "unknown" } of [{ id: 1 }, { id: 2, label: "two" }]) labels.push(label)
      return { id, label, labels }
    `),
    ).toEqual({ id: 2, label: "two", labels: ["unknown", "two"] })
  })
})

describe("sequence expressions", () => {
  test("evaluate left to right and return the final value", async () => {
    expect(await value(`let x = 0; const result = (x += 1, x *= 3, x + 2); return { x, result }`)).toEqual({
      x: 3,
      result: 5,
    })
  })

  test("support comma-separated for-loop updates", async () => {
    expect(
      await value(`
      const pairs = []
      for (let left = 0, right = 3; left < right; left++, right--) pairs.push([left, right])
      return pairs
    `),
    ).toEqual([
      [0, 3],
      [1, 2],
    ])
  })
})

describe("destructuring assignment", () => {
  test("assigns object and array patterns to existing bindings", async () => {
    expect(
      await value(`
        let a = 0
        let b = 0
        ;({ a } = { a: 2 })
        ;[a, b] = [3, 4]
        return [a, b]
      `),
    ).toEqual([3, 4])
  })

  test("supports defaults, nesting, rest, and member targets", async () => {
    expect(
      await value(`
        let first = 0
        let fallback = 0
        let rest = {}
        const target = {}
        ;[first, fallback = 2, ...target.tail] = [1]
        ;({ nested: { value: target.value }, kept: target.kept = 3, ...rest } = {
          nested: { value: 4 },
          extra: 5,
        })
        return { first, fallback, target, rest }
      `),
    ).toEqual({ first: 1, fallback: 2, target: { tail: [], value: 4, kept: 3 }, rest: { extra: 5 } })
  })

  test("returns the assigned value", async () => {
    expect(await value(`let a = 0; const result = ([a] = [7]); return [a, result]`)).toEqual([7, [7]])
  })

  test("supports computed object keys and evaluates them once", async () => {
    expect(
      await value(`
        let calls = 0
        const field = () => { calls++; return "name" }
        const { [field()]: name, ...rest } = { name: "Ada", role: "engineer" }
        return { calls, name, rest }
      `),
    ).toEqual({ calls: 1, name: "Ada", rest: { role: "engineer" } })
  })

  test("supports object patterns over arrays; detached methods lose their receiver like JS", async () => {
    expect(
      await value(`
        const { 0: first, length, slice, ...rest } = ["a", "b", "c"]
        return { first, length, sliced: slice === Array.prototype.slice, rest }
      `),
    ).toEqual({ first: "a", length: 3, sliced: true, rest: { 1: "b", 2: "c" } })
    expect((await error(`const { slice } = [1]; slice(0)`)).message).toContain("Array.prototype.slice called on")
  })

  test("preserves exact computed property names on arrays", async () => {
    expect(
      await value(`
        const { ["01"]: item, ...rest } = [10, 20]
        return { missing: item === undefined, rest }
      `),
    ).toEqual({ missing: true, rest: { 0: 10, 1: 20 } })
  })

  test("supports array patterns over strings, Maps, Sets, and URLSearchParams", async () => {
    expect(
      await value(`
        const [letter, ...letters] = "A😀B"
        const [[mapKey, mapValue]] = new Map([["key", 1]])
        const [setFirst, setSecond] = new Set([2, 3])
        const [[queryKey, queryValue]] = new URLSearchParams("q=test&page=2")
        return { letter, letters, mapKey, mapValue, setFirst, setSecond, queryKey, queryValue }
      `),
    ).toEqual({
      letter: "A",
      letters: ["😀", "B"],
      mapKey: "key",
      mapValue: 1,
      setFirst: 2,
      setSecond: 3,
      queryKey: "q",
      queryValue: "test",
    })
  })

  test("supports iterable patterns in assignment and parameters", async () => {
    expect(
      await value(`
        let first
        let rest
        ;[first, ...rest] = new Set([1, 2, 3])
        const read = ([[key, value]]) => key + value
        return { first, rest, entry: read(new Map([["a", 4]])) }
      `),
    ).toEqual({ first: 1, rest: [2, 3], entry: "a4" })
  })

  test("excludes computed numeric keys from object rest", async () => {
    expect(
      await value(`
        const { [0]: declared, ...declarationRest } = { 0: "a", 1: "b" }
        let assigned
        let assignmentRest
        ;({ [0]: assigned, ...assignmentRest } = { 0: "c", 1: "d" })
        return { declared, declarationRest, assigned, assignmentRest }
      `),
    ).toEqual({ declared: "a", declarationRest: { 1: "b" }, assigned: "c", assignmentRest: { 1: "d" } })
  })

  test("computed keys of any type become their string form, as in JS", async () => {
    expect(
      await value(`
        const counts = {}
        for (const category of ["a", null, undefined, "a", true, 1.5]) counts[category] = (counts[category] ?? 0) + 1
        const key = {}
        const { [key]: value } = { "[object Object]": 7 }
        const o = { null: 1, "1,2": 2 }
        return [counts, value, o[null], o[[1, 2]], undefined in o]
      `),
    ).toEqual([{ a: 2, null: 1, undefined: 1, true: 1, "1.5": 1 }, 7, 1, 2, false])
  })
})

describe("coercion parity: zero-argument coercion functions", () => {
  test("Number() is 0 and String() is empty, unlike their undefined-argument forms", async () => {
    expect(await value(`return Number()`)).toBe(0)
    expect(await value(`return String()`)).toBe("")
    expect(await value(`return Boolean()`)).toBe(false)
    expect(await value(`return Number.isNaN(Number(undefined))`)).toBe(true)
    expect(await value(`return String(undefined)`)).toBe("undefined")
  })

  test("parseInt() and parseFloat() stay NaN with no argument", async () => {
    expect(await value(`return Number.isNaN(parseInt())`)).toBe(true)
    expect(await value(`return Number.isNaN(parseFloat())`)).toBe(true)
  })
})

describe("coercion parity: global isFinite and isNaN", () => {
  test("coerce their argument like native JS, unlike the Number statics", async () => {
    expect(await value(`return isFinite("42")`)).toBe(true)
    expect(await value(`return Number.isFinite("42")`)).toBe(false)
    expect(await value(`return isNaN("oops")`)).toBe(true)
    expect(await value(`return isNaN("42")`)).toBe(false)
    expect(await value(`return isFinite(Infinity)`)).toBe(false)
    expect(await value(`return isNaN(null)`)).toBe(false)
  })

  test("zero-argument forms match native", async () => {
    expect(await value(`return isFinite()`)).toBe(false)
    expect(await value(`return isNaN()`)).toBe(true)
  })

  test("read as functions", async () => {
    expect(await value(`return typeof isFinite`)).toBe("function")
    expect(await value(`return typeof isNaN`)).toBe("function")
  })

  test("work as array callbacks", async () => {
    expect(await value(`return [1, "2", "x", Infinity].filter(isFinite)`)).toEqual([1, "2"])
    expect(await value(`return ["1", "x"].map(isNaN)`)).toEqual([false, true])
  })
})

describe("coercion parity: built-in arguments coerce as in JS", () => {
  test("numeric arguments apply ToIntegerOrInfinity", async () => {
    expect(
      await value(`
        return [
          [1, 2, 3].indexOf(2, "1"), [1, 2, 3].lastIndexOf(3, "5"), [1, 2, 3].includes(1, "1"),
          [1, 2, 3, 4].slice("1", "3"), [1, 2, 3].at(null), [1, 2, 3].at(1.7),
          [1, [2, [3]]].flat(1.9), [1, 2, 3].with(1.5, 9), [1, 2, 3, 4].splice("1", "2"),
          Math.max("3", "2"), Math.floor(null), Math.hypot("3", "4"),
          parseInt("11", "2"), Number.parseInt("ff", "16"), (1.5).toFixed("2"), (255).toString("16"),
          String.fromCharCode("65", 66.9), new Uint8Array([1, 2, 3]).indexOf(2, "1"),
        ]
      `),
    ).toEqual([1, 2, false, [2, 3], 1, 2, [1, 2, [3]], [1, 9, 3], [2, 3], 3, 0, 5, 3, 255, "1.50", "ff", "AB", 1])
  })

  test("join separators, JSON.parse text, and Array.from length coerce", async () => {
    expect(
      await value(`
        return [
          [1, 2].join(null), [1, 2].join(0), [1, 2].join(undefined), new Uint8Array([1, 2]).join(null),
          JSON.parse(123), JSON.parse(true),
          Array.from({ length: "2" }), Array.from({ length: 2.5 }), Array.from({ length: -1 }), Array.from({}),
        ]
      `),
    ).toEqual(["1null2", "102", "1,2", "1null2", 123, true, [null, null], [null, null], [], []])
    expect((await error(`return JSON.parse(undefined)`)).message).toContain("JSON")
  })
})

describe("coercion parity: arrays coerce to numbers through their string form", () => {
  test("arrays with objects become NaN instead of crashing on host ToPrimitive", async () => {
    expect(await value(`let x = [{}]; x++; return Number.isNaN(x)`)).toBe(true)
    expect(await value(`return isFinite([{}])`)).toBe(false)
    expect(await value(`return "abc".slice([{}])`)).toBe("abc")
  })

  test("single-element and empty arrays match native Number()", async () => {
    expect(await value(`return Number([5])`)).toBe(5)
    expect(await value(`return Number([])`)).toBe(0)
    expect(await value(`return Number.isNaN(Number([1, 2]))`)).toBe(true)
  })
})

describe("coercion parity: String method arguments coerce like native JS", () => {
  test("includes and indexOf coerce numbers", async () => {
    expect(await value(`return "v1.2".includes(1)`)).toBe(true)
    expect(await value(`return "a2b".indexOf(2)`)).toBe(1)
    expect(await value(`return "abc".includes("d")`)).toBe(false)
  })

  test("slice, repeat, and padStart coerce numeric strings", async () => {
    expect(await value(`return "abc".slice("1")`)).toBe("bc")
    expect(await value(`return "ab".repeat("2")`)).toBe("abab")
    expect(await value(`return "7".padStart("3", 0)`)).toBe("007")
  })

  test("split coerces separators but treats undefined as absent", async () => {
    expect(await value(`return "a1b".split(1)`)).toEqual(["a", "b"])
    expect(await value(`return "a,b".split(undefined)`)).toEqual(["a,b"])
    expect(await value(`return "a,b".split()`)).toEqual(["a,b"])
    expect(await value(`return "a,b".split(undefined, 0)`)).toEqual([])
    expect(await value(`return "a,b".split(undefined, 1)`)).toEqual(["a,b"])
  })

  test("replace coerces search and replacement values", async () => {
    expect(await value(`return "a1b".replace(1, 2)`)).toBe("a2b")
    expect(await value(`return "a1b".replace(1, () => "x")`)).toBe("axb")
  })

  test("repeat rejections carry the native RangeError name", async () => {
    expect(await value(`try { "a".repeat(-1) } catch (e) { return e.name }`)).toBe("RangeError")
  })

  test("includes, startsWith, and endsWith reject regular expressions with a TypeError", async () => {
    expect(await value(`try { "abc".includes(/a/) } catch (e) { return e.name }`)).toBe("TypeError")
    expect(await value(`try { "abc".startsWith(/a/) } catch (e) { return e.name }`)).toBe("TypeError")
    expect(await value(`try { "abc".endsWith(/a/) } catch (e) { return e.name }`)).toBe("TypeError")
  })

  test("opaque runtime references still reject as data errors", async () => {
    const err = await error(`const f = () => 1; return "abc".includes(f)`)
    expect(err.message).toContain("data value")
    const replacerErr = await error(`const f = () => 1; return "a".replace(f, () => "x")`)
    expect(replacerErr.message).toContain("data value")
  })
})

describe("coercion parity: match() and search() with no argument", () => {
  test("behave as an empty pattern like native JS", async () => {
    expect(await value(`return "abc".search()`)).toBe(0)
    expect(await value(`const m = "abc".match(); return { first: m[0], index: m.index }`)).toEqual({
      first: "",
      index: 0,
    })
  })
})

describe("coercion parity: ++ and -- use CodeMode numeric coercion", () => {
  test("numeric strings increment like native JS", async () => {
    expect(await value(`let x = "5"; x++; return x`)).toBe(6)
    expect(await value(`let x = "5"; return ++x`)).toBe(6)
    expect(await value(`const o = { n: "2" }; o.n--; return o.n`)).toBe(1)
  })

  test("dates increment through their epoch time", async () => {
    expect(await value(`let d = new Date(5); d++; return d`)).toBe(6)
  })

  test("plain data objects become NaN instead of crashing", async () => {
    expect(await value(`let x = {}; x++; return Number.isNaN(x)`)).toBe(true)
    expect(await value(`const o = { a: {} }; o.a++; return Number.isNaN(o.a)`)).toBe(true)
  })

  test("opaque runtime references reject with a clear error", async () => {
    const err = await error(`let f = () => 1; f++`)
    expect(err.message).toContain("data value")
  })
})

describe("coercion parity: unknown static members read as undefined", () => {
  test("feature detection on missing statics works like native JS", async () => {
    expect(await value(`return typeof Math.sum`)).toBe("undefined")
    expect(await value(`return RegExp.quote === undefined`)).toBe(true)
    expect(await value(`return Number.range === undefined`)).toBe(true)
    expect(await value(`return String.dedent === undefined`)).toBe(true)
    expect(await value(`return isFinite.something === undefined`)).toBe(true)
    expect(await value(`return console.group === undefined`)).toBe(true)
    expect(await value(`return Date.moment === undefined`)).toBe(true)
    expect(await value(`return JSON.rawJSON === undefined`)).toBe(true)
    expect(await value(`return URL.createObjectURL === undefined`)).toBe(true)
    expect(await value(`return Math.sum?.([1]) ?? "fallback"`)).toBe("fallback")
  })

  test("known statics still resolve and run", async () => {
    expect(await value(`return typeof Math.max`)).toBe("function")
    expect(await value(`return typeof console.log`)).toBe("function")
    expect(await value(`return typeof Date.now`)).toBe("function")
    expect(await value(`return typeof Math.sumPrecise`)).toBe("function")
    expect(await value(`return typeof RegExp.escape`)).toBe("function")
    expect(await value(`return typeof Object.groupBy`)).toBe("function")
    expect(await value(`return typeof Map.groupBy`)).toBe("function")
    expect(await value(`return Math.max(1, 2)`)).toBe(2)
    expect(await value(`return Math.sumPrecise([1, 2])`)).toBe(3)
    expect(await value(`return RegExp.escape("a.b")`)).toBe("\\x61\\.b")
    expect(await value(`return URL.canParse("https://example.com")`)).toBe(true)
    expect(await value(`return Number.isInteger(3)`)).toBe(true)
    expect(await value(`return Number.MAX_SAFE_INTEGER`)).toBe(Number.MAX_SAFE_INTEGER)
  })

  test("calling an unknown static reports a native-style TypeError", async () => {
    expect(await value(`try { Math.sum([1]) } catch (e) { return e.name + ": " + e.message }`)).toBe(
      "TypeError: Math.sum is not a function.",
    )
    expect(await value(`try { Math["sum"]([1]) } catch (e) { return e.message }`)).toBe("Math.sum is not a function.")
    expect(await value(`try { JSON.rawJSON("1") } catch (e) { return e.message }`)).toBe(
      "JSON.rawJSON is not a function.",
    )
    expect(await value(`try { search({ query: "star" }).catch(() => 1) } catch (e) { return e.message }`)).toBe(
      "search(...).catch is not a function.",
    )
    expect(
      await value(`const foo = () => ({ bar: () => ({}) }); try { foo().bar().baz() } catch (e) { return e.message }`),
    ).toBe("foo(...).bar(...).baz is not a function.")
  })

  test("built-ins are objects on a real prototype chain", async () => {
    expect(
      await value(`
        return [
          Math.constructor === Object,
          Number.constructor === Function,
          Object.prototype.hasOwnProperty === ({}).hasOwnProperty,
          Array.prototype.push.name,
          Array.prototype.push.length,
          Math.max.length,
          Object.keys(Math),
          typeof Array.prototype.map,
          Array.isArray(Array.prototype),
        ]
      `),
    ).toEqual([true, true, true, "push", 1, 2, [], "function", true])
  })
})

describe("async function line breaks", () => {
  test("a line break between function and the name is an async function", async () => {
    expect(await value(`async function\nfoo() { return 1 }\nreturn await foo()`)).toBe(1)
  })

  test("a line break between async and function is not an async function", async () => {
    const failure = await error(`async\nfunction foo() { return 1 }\nreturn foo()`)
    expect(failure.message).toContain("Unknown identifier 'async'")
  })
})

describe("functions are objects", () => {
  test("name follows NamedEvaluation and length counts required parameters", async () => {
    expect(
      await value(`
        function decl(a, b = 1, ...rest) {}
        const arrow = () => {}
        const named = function inner() {}
        let assigned
        assigned = (a, b) => {}
        const { fromDefault = () => {} } = {}
        const [fromArray = function () {}] = []
        const obj = { method() {}, key: () => {}, [Symbol.iterator]: () => {} }
        const passthrough = (0, () => {})
        return [
          [decl.name, decl.length],
          [arrow.name, named.name, assigned.name, assigned.length],
          [fromDefault.name, fromArray.name],
          [obj.method.name, obj.key.name, obj[Symbol.iterator].name],
          passthrough.name,
        ]
      `),
    ).toEqual([
      ["decl", 1],
      ["arrow", "inner", "assigned", 2],
      ["fromDefault", "fromArray"],
      ["method", "key", "[Symbol.iterator]"],
      "",
    ])
  })

  test("functions hold own properties; name and length are read-only", async () => {
    expect(
      await value(`
        const fn = () => 1
        fn.count = 2
        fn.count += 1
        let renamed = false
        try { fn.name = "other" } catch (error) { renamed = error instanceof TypeError }
        const { name, count } = fn
        return [fn.count, Object.keys(fn), "count" in fn, "name" in fn, name, count, renamed, delete fn.count, fn.count]
      `),
    ).toEqual([3, ["count"], true, true, "fn", 3, true, true, null])
  })
})

describe("tagged templates", () => {
  test("the tag receives the cooked strings, their raw forms, and the substitutions in order", async () => {
    expect(
      await value(`
        const tag = (strings, ...values) => [strings, strings.raw, values, Object.keys(strings)]
        return tag\`a\${1}b\\n\${2}c\`
      `),
    ).toEqual([
      ["a", "b\n", "c"],
      ["a", "b\\n", "c"],
      [1, 2],
      ["0", "1", "2"],
    ])
  })

  test("an invalid escape cooks to undefined and keeps its raw text", async () => {
    expect(await value(`return ((strings) => [strings[0] === undefined, strings.raw[0]])\`\\unicode\``)).toEqual([
      true,
      "\\unicode",
    ])
  })

  test("each site has one template object; different sites differ", async () => {
    expect(
      await value(`
        const seen = []
        const tag = (strings) => { seen.push(strings) }
        for (let i = 0; i < 2; i++) tag\`x\${i}\`
        tag\`x\${0}\`
        return [seen[0] === seen[1], seen[0] === seen[2]]
      `),
    ).toEqual([true, false])
  })

  test("the tag is read like a callee: members, chained tags, async tags, and the not-a-function error", async () => {
    expect(
      await value(`
        const o = { tag: (strings) => strings[0].toUpperCase() }
        const chain = () => chain
        const asyncTag = async (strings, value) => strings[0] + value
        let failure
        try { (1)\`x\` } catch (error) { failure = error instanceof TypeError }
        return [o.tag\`abc\`, typeof chain\`a\`\`b\`, await asyncTag\`n=\${1}\`, failure]
      `),
    ).toEqual(["ABC", "function", "n=1", true])
  })

  test("raw is read-only", async () => {
    expect(await value(`try { ((strings) => { strings.raw = 1 })\`a\` } catch (error) { return error.name }`)).toBe(
      "TypeError",
    )
  })
})

describe("String.raw", () => {
  test("joins the raw strings with the substitutions", async () => {
    expect(await value(`return [String.raw\`a\\n\${1}b\`, String.raw({ raw: ["x", "y", "z"] }, 1, 2, 3)]`)).toEqual([
      "a\\n1b",
      "x1y2z",
    ])
  })

  test("extra substitutions are dropped, missing ones are skipped, and a program object's toString is used", async () => {
    expect(
      await value(`
        const shout = { toString() { return "!" } }
        return [String.raw({ raw: ["x", "y"] }, 1, 2), String.raw({ raw: ["x", "y", "z"] }, shout), String.raw({ raw: { length: 0 } })]
      `),
    ).toEqual(["x1y", "x!yz", ""])
  })

  test("a template without a raw array is a TypeError", async () => {
    const failure = await error(`String.raw(1)`)
    expect(failure.message).toContain("String.raw expects a template object with a raw array")
  })
})

describe("sloppy duplicate parameters and for...in targets", () => {
  test("a repeated parameter name binds the last argument", async () => {
    expect(await value(`function f(a, b, a) { return [a, b] } return [f(1, 2, 3), f(1)]`)).toEqual([
      [3, 2],
      [null, null],
    ])
  })

  test("for...in assigns to any target: members, computed members, and patterns", async () => {
    expect(
      await value(`
        const x = {}, seen = [], a = []
        let i = 0, first
        for (x.y in { p: 1, q: 2 }) seen.push(x.y)
        for (a[i++] in { p: 1, q: 2 });
        for ([first] in { ab: 1 });
        return [seen, x.y, a, first]
      `),
    ).toEqual([["p", "q"], "q", ["p", "q"], "a"])
  })
})

describe("loose equality and operator gates on opaque references", () => {
  test("== follows IsLooselyEqual for data values", async () => {
    expect(
      await value(`
        return [null == undefined, "1" == 1, true == 1, "" == 0, [1] == 1, [1, 2] == "1,2",
          ({}) == "[object Object]", NaN == NaN, ({}) == ({}), null == 0, new Date(0) == 0]
      `),
    ).toEqual([true, true, true, true, true, true, true, false, false, false, false])
  })

  test("functions and tool references compare by identity and are never equal to nullish", async () => {
    expect(
      await value(`
        const fn = () => 1, other = () => 2
        return [fn == null, fn != null, fn == undefined, fn == fn, fn == other, [fn] == null, ({ f: fn }) == null,
          [fn] == [fn], tools == null, tools == tools]
      `),
    ).toEqual([false, true, false, true, false, false, false, false, false, true])
  })

  test("coercing an opaque reference against a non-nullish primitive still rejects", async () => {
    expect((await error(`const fn = () => 1; return fn == 1`)).message).toContain(
      "Binary operators require data values",
    )
    expect((await error(`const fn = () => 1; return fn + ""`)).message).toContain(
      "Binary operators require data values",
    )
    expect((await error(`const fn = () => 1; return -fn`)).message).toContain("Unary operators require data values")
    expect((await error(`let fn = () => 1; fn++`)).message).toContain("'++' requires a data value")
  })

  test("switch and Object.is match opaque references by identity", async () => {
    expect(
      await value(`
        const fn = () => 1, other = () => 2
        const pick = (v) => { switch (v) { case fn: return "fn"; case other: return "other"; default: return "none" } }
        return [pick(fn), pick(other), pick(1), Object.is(fn, fn), Object.is(fn, other), Object.is(NaN, NaN), Object.is(0, -0)]
      `),
    ).toEqual(["fn", "other", "none", true, false, true, false])
  })

  test("operators look only at their direct operands, so nested functions coerce like other data", async () => {
    expect(
      await value(`
        const fn = () => 1
        let x = [fn]
        x++
        return [[1, [2]] + "", ({ a: 1 }) * 2, [fn] + "", Number.isNaN(-[fn]), Number.isNaN(x), typeof fn, !fn]
      `),
    ).toEqual(["1,2", null, "[object Function]", true, true, "function", false])
  })
})

describe("Object.freeze, seal, and preventExtensions", () => {
  test("a frozen object rejects writes, additions, and deletes with TypeErrors", async () => {
    expect(
      await value(`
        const o = Object.freeze({ a: 1 })
        const errors = []
        try { o.a = 2 } catch (e) { errors.push(e.name + ": " + e.message) }
        try { o.b = 2 } catch (e) { errors.push(e.name + ": " + e.message) }
        try { delete o.a } catch (e) { errors.push(e.name + ": " + e.message) }
        return [errors, o.a, Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o)]
      `),
    ).toEqual([
      [
        "TypeError: Cannot assign to read only property 'a'.",
        "TypeError: Cannot add property b, object is not extensible.",
        "TypeError: Cannot delete property 'a'.",
      ],
      1,
      true,
      true,
      false,
    ])
  })

  test("seal keeps writes, preventExtensions keeps deletes, and each returns its argument", async () => {
    expect(
      await value(`
        const s = { a: 1 }, p = { a: 1 }
        const errors = []
        Object.seal(s).a = 2
        try { delete s.a } catch (e) { errors.push(e.name) }
        delete Object.preventExtensions(p).a
        try { p.b = 1 } catch (e) { errors.push(e.name) }
        return [errors, s.a, Object.keys(p), Object.isSealed(s), Object.isFrozen(s), Object.isSealed(p), Object.isFrozen(p)]
      `),
    ).toEqual([["TypeError", "TypeError"], 2, [], true, false, true, true])
  })

  test("primitives pass through, and Object.assign honors the flags", async () => {
    expect(
      await value(`
        return [Object.freeze(1) === 1, Object.isFrozen(1), Object.isSealed("a"), Object.isExtensible(null), Object.isFrozen({}), Object.isExtensible({})]
      `),
    ).toEqual([true, true, true, false, false, true])
    const failure = await error(`Object.assign(Object.freeze({ a: 1 }), { b: 1 })`)
    expect(failure.message).toContain("Cannot add property b, object is not extensible")
  })

  test("frozen arrays reject element, length, and mutating-method writes like JS", async () => {
    expect(
      await value(`
        const a = Object.freeze([1, 2])
        const attempt = (f) => { try { f(); return "ok" } catch (e) { return e.name + ": " + e.message } }
        return [
          attempt(() => a.push(3)),
          attempt(() => { a[0] = 9 }),
          attempt(() => { a[5] = 9 }),
          attempt(() => { a.length = 0 }),
          attempt(() => a.pop()),
          attempt(() => a.sort()),
          attempt(() => a.reverse()),
          attempt(() => a.fill(0)),
          attempt(() => a.copyWithin(0, 1)),
          attempt(() => a.splice(0, 1)),
          attempt(() => a.unshift(0)),
          a, a.map((x) => x * 2), Object.isFrozen(a), Object.isFrozen(Object.freeze([])),
        ]
      `),
    ).toEqual([
      "TypeError: Cannot add property 2, object is not extensible.",
      "TypeError: Cannot assign to read only property '0'.",
      "TypeError: Cannot add property 5, object is not extensible.",
      "TypeError: Cannot assign to read only property 'length'.",
      "TypeError: Cannot delete property '1'.",
      "TypeError: Cannot assign to read only property '0'.",
      "TypeError: Cannot assign to read only property '0'.",
      "TypeError: Cannot assign to read only property '0'.",
      "TypeError: Cannot assign to read only property '0'.",
      "TypeError: Cannot delete property '1'.",
      "TypeError: Cannot add property 2, object is not extensible.",
      [1, 2],
      [2, 4],
      true,
      true,
    ])
  })

  test("sealed and non-extensible arrays allow exactly the writes JS does", async () => {
    expect(
      await value(`
        const s = Object.seal([1, 2]), p = Object.preventExtensions([1, 2, 3])
        const attempt = (f) => { try { f(); return "ok" } catch (e) { return e.name } }
        const results = [attempt(() => { s[0] = 5 }), attempt(() => s.pop()), attempt(() => { s.length = 0 }), attempt(() => s.push(1))]
        p.pop(); p.sort(); p.reverse(); p.fill(0, 1); p.copyWithin(0, 1); p.length = 5
        results.push(attempt(() => p.push(1)), attempt(() => p.splice(0, 1, 7, 8)), p.splice(0, 1, 7), attempt(() => { p[9] = 1 }))
        return [results, s, p, Object.isSealed(p), Object.isFrozen(p), Object.isSealed(Object.preventExtensions([])), Object.isFrozen(Object.preventExtensions([]))]
      `),
    ).toEqual([
      ["ok", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", [0], "TypeError"],
      [5, 2],
      [7, 0, null, null, null],
      false,
      false,
      true,
      false,
    ])
  })

  test("typed arrays with elements cannot be frozen; wrappers freeze their properties only", async () => {
    const failure = await error(`Object.freeze(new Uint8Array([1]))`)
    expect(failure.message).toContain("Cannot freeze array buffer views with elements")
    expect(
      await value(`
        const empty = Object.freeze(new Uint8Array(0))
        const bytes = Object.preventExtensions(new Uint8Array([1]))
        const m = Object.freeze(new Map()); m.set(1, 2)
        const f = Object.freeze(() => 1)
        let named = "ok"
        try { f.x = 1 } catch (e) { named = e.name }
        return [Object.isFrozen(empty), Object.isFrozen(bytes), Object.isExtensible(bytes), m.size, Object.isFrozen(f), named, f()]
      `),
    ).toEqual([true, false, false, 1, true, "TypeError", 1])
  })
})

describe("Object.getPrototypeOf and Object.create", () => {
  test("getPrototypeOf returns the built-in prototypes for objects and primitives", async () => {
    expect(
      await value(`
        return [
          Object.getPrototypeOf([]) === Array.prototype,
          Object.getPrototypeOf({}) === Object.prototype,
          Object.getPrototypeOf(Object.prototype),
          Object.getPrototypeOf("a") === String.prototype,
          Object.getPrototypeOf(1) === Number.prototype,
          Object.getPrototypeOf(true) === Boolean.prototype,
          Object.getPrototypeOf(new TypeError("x")) === TypeError.prototype,
          Object.getPrototypeOf(TypeError.prototype) === Error.prototype,
          Object.getPrototypeOf(() => 1) === Function.prototype,
        ]
      `),
    ).toEqual([true, true, null, true, true, true, true, true, true])
  })

  test("getPrototypeOf rejects null, undefined, and symbols", async () => {
    expect((await error(`Object.getPrototypeOf(null)`)).message).toContain("cannot convert null to an object")
    expect((await error(`Object.getPrototypeOf(undefined)`)).message).toContain("cannot convert undefined to an object")
    expect((await error(`Object.getPrototypeOf(Symbol.iterator)`)).message).toContain("cannot convert a symbol")
  })

  test("Object.create links the prototype: inherited reads, in, and own-only keys", async () => {
    expect(
      await value(`
        const p = { greet(name) { return "hi " + name }, a: 1 }
        const c = Object.create(p)
        c.name = "x"
        const seen = []
        for (const key in c) seen.push(key)
        return ["greet" in c, Object.keys(c), c.hasOwnProperty("a"), c.a, c.greet(c.name), Object.getPrototypeOf(c) === p, Object.getPrototypeOf(Object.create(null)), seen]
      `),
    ).toEqual([true, ["name"], false, 1, "hi x", true, null, ["name"]])
  })

  test("Object.create rejects non-object prototypes and property descriptors", async () => {
    expect((await error(`Object.create(1)`)).message).toContain("Object prototype may only be an Object or null")
    expect((await error(`Object.create()`)).message).toContain("Object prototype may only be an Object or null")
    expect((await error(`Object.create(null, { a: { value: 1 } })`)).message).toContain(
      "Object.create property descriptors are not supported",
    )
    expect(await value(`return Object.keys(Object.create({}, undefined))`)).toEqual([])
  })
})

describe("structuredClone", () => {
  test("deep-copies data values and keeps shared references shared", async () => {
    expect(
      await value(`
        const shared = { n: 1 }
        const source = { a: shared, b: shared, list: [1, , shared], map: new Map([[1, { a: [1, 2] }]]), set: new Set([shared]), when: new Date(5), bytes: new Uint8Array([1, 2]) }
        const c = structuredClone(source)
        c.a.n = 2
        return [
          c !== source, c.a === c.b, c.a !== shared, shared.n, c.list[2] === c.a, 1 in c.list, c.list.length,
          c.map.get(1).a, c.map !== source.map, c.set.has(c.a), c.when.getTime(), c.when instanceof Date,
          c.bytes instanceof Uint8Array, c.bytes[1], Array.isArray(c.list),
        ]
      `),
    ).toEqual([true, true, true, 1, true, false, 3, [1, 2], true, true, 5, true, true, 2, true])
  })

  test("regexps reset lastIndex, errors keep name, message, and cause, and extras are dropped", async () => {
    expect(
      await value(`
        const r = /a/g
        r.lastIndex = 3
        const e = new TypeError("boom", { cause: { code: 1 } })
        e.extra = 1
        const custom = new Error("x")
        custom.name = "Custom"
        const [cr, ce, cc] = [structuredClone(r), structuredClone(e), structuredClone(custom)]
        return [cr.source, cr.flags, cr.lastIndex, ce instanceof TypeError, ce.name, ce.message, ce.cause, ce.cause !== e.cause, ce.extra, Object.keys(ce), cc.name]
      `),
    ).toEqual(["a", "g", 0, true, "TypeError", "boom", { code: 1 }, true, null, [], "Error"])
  })

  test("the clone is a plain extensible object: prototypes, symbols, undefined fields, and frozen state drop", async () => {
    expect(
      await value(`
        const c = structuredClone(Object.freeze(Object.assign(Object.create({ inherited: 1 }), { a: undefined, [Symbol.iterator]: 1, b: 2 })))
        return [Object.isFrozen(c), Object.getPrototypeOf(c) === Object.prototype, "a" in c, Symbol.iterator in c, c.b, c.inherited]
      `),
    ).toEqual([false, true, true, false, 2, null])
  })

  test("functions, symbols, promises, wrappers, and tool references throw a DataCloneError TypeError", async () => {
    for (const code of [
      `structuredClone(() => 1)`,
      `structuredClone({ deep: [Symbol.iterator] })`,
      `structuredClone(Promise.resolve(1))`,
      `structuredClone(new URL("http://x"))`,
      `structuredClone(tools)`,
    ]) {
      const failure = await error(code)
      expect(failure.message).toMatch(/^TypeError: DataCloneError: .* could not be cloned\./)
    }
    expect(await value(`try { structuredClone(() => 1) } catch (e) { return e.name }`)).toBe("TypeError")
    expect((await error(`structuredClone()`)).message).toContain("structuredClone requires 1 argument")
  })
})

describe("error constructor prototype chain", () => {
  test("derived error constructors extend Error and inherit its statics", async () => {
    expect(
      await value(`
        const derived = [TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError, AggregateError]
        return [
          derived.every((ctor) => Object.getPrototypeOf(ctor) === Error),
          Object.getPrototypeOf(Error) === Function.prototype,
          TypeError.isError(new RangeError("x")),
          new TypeError("x") instanceof Error,
        ]
      `),
    ).toEqual([true, true, true, true])
  })
})

describe("this, arguments, and Function.prototype.call/apply/bind", () => {
  test("this is the call receiver for non-arrow functions and lexical for arrows", async () => {
    expect(
      await value(`
        const o = { n: 1, m() { return this.n }, a() { return (() => this.n)() }, bare() { return this } }
        const detached = o.bare
        function f() { return this }
        return [o.m(), o["m"](), o?.m(), (o.m)(), o.a(), o.bare() === o, detached(), f(), (0, o.bare)(), this, (() => this)()]
      `),
    ).toEqual([1, 1, 1, 1, 1, true, null, null, null, null, null])
  })

  test("this reaches generator and async methods and plain-function callbacks", async () => {
    expect(
      await value(`
        const o = { n: 2, *g() { yield this.n }, async m() { return this.n }, xs: [1, 2], go() { return this.xs.map(function (x) { return [x, this] }) } }
        return [[...o.g()], await o.m(), o.go()]
      `),
    ).toEqual([
      [2],
      2,
      [
        [1, null],
        [2, null],
      ],
    ])
  })

  test("arguments is an unmapped array-like that arrows and parameters interact with as in JS", async () => {
    expect(
      await value(`
        function f(a) { arguments[0] = 9; return [arguments.length, arguments[1], a, [...arguments], Array.isArray(arguments), JSON.stringify(arguments), typeof arguments.map, (() => arguments[1])()] }
        function shadow(arguments) { return arguments }
        function hoisted() { var arguments; return arguments.length }
        let outer
        try { outer = arguments } catch (error) { outer = error.name }
        return [f(1, 2), shadow(7), hoisted(1, 2, 3), outer]
      `),
    ).toEqual([[2, 2, 1, [9, 2], false, '{"0":9,"1":2}', "undefined", 2], 7, 3, "ReferenceError"])
  })

  test("call, apply, and bind set this and arguments on program functions and built-ins", async () => {
    expect(
      await value(`
        function f(a, b, c) { return [this, a, b, c] }
        const g = f.bind({ k: 1 }, "A")
        const arr = [1]
        Array.prototype.push.call(arr, 2, 3)
        return [
          f.call("t", 1, 2),
          f.apply({ k: 2 }, [1, 2]),
          f.apply(null, { length: 2, 0: "x", 1: "y" }),
          f.apply(null).length,
          g("B", "C"), g.name, g.length,
          f.bind(1).bind(2)()[0],
          arr,
          Math.max.apply(null, [1, 5, 3]),
          Math.max.bind(null, 10)(3),
          [1, 2].map(f.bind(null, 0)).map((r) => r[1]),
        ]
      `),
    ).toEqual([
      ["t", 1, 2, null],
      [{ k: 2 }, 1, 2, null],
      [null, "x", "y", null],
      4,
      [{ k: 1 }, "A", "B", "C"],
      "bound f",
      2,
      1,
      [1, 2, 3],
      5,
      10,
      [0, 0],
    ])
  })

  test("call and apply reject non-callable receivers and non-array-like argument lists", async () => {
    expect((await error(`Function.prototype.call.call(1)`)).message).toContain(
      "Function.prototype.call called on incompatible receiver",
    )
    expect((await error(`(() => 1).apply(null, 5)`)).message).toContain("expects an array-like argument list")
    expect((await error(`(() => 1).apply(null, { length: 1e9 })`)).message).toContain("Invalid array length")
    expect(
      await value(
        `function f() { return arguments.length } return [f.apply(null, { length: -5 }), f.apply(null, { length: "2" })]`,
      ),
    ).toEqual([0, 2])
    expect((await error(`function f(n) { return f.call(null, n + 1) } f(0)`)).message).toContain(
      "Maximum call stack size exceeded",
    )
  })
})

describe("ToPrimitive: operators and conversions honor program valueOf and toString", () => {
  test("== converts an object facing a non-nullish primitive through its own valueOf", async () => {
    expect(
      await value(`
        const one = { valueOf() { return 1 } }
        return [one == 1, 1 == one, one == true, one == "1", one == null, one == one, one == { valueOf() { return 1 } }, [1] == 1]
      `),
    ).toEqual([true, true, true, true, false, true, false, true])
    expect((await error(`(() => 1) == 1`)).message).toContain("Binary operators require data values")
  })

  test("operators, unary, template literals, and conversion functions use the object's own methods", async () => {
    expect(
      await value(`
        const money = { valueOf() { return 7 } }
        return [money * 2, money + 1, money + "", -money, +money, ~money, money < 8, money ** 2, money | 8,
          Number(money), Math.max(money, 1), \`\${money}\`, String(money), isNaN(money), isFinite(money),
          parseInt({ toString() { return "42px" } }), parseInt("ff", { valueOf() { return 16 } }),
          Number.parseFloat({ toString() { return "1.5" } })]
      `),
    ).toEqual([
      14,
      8,
      "7",
      -7,
      7,
      -8,
      true,
      49,
      15,
      7,
      7,
      "[object Object]",
      "[object Object]",
      false,
      true,
      42,
      255,
      1.5,
    ])
  })

  test("the hint picks the method: + and Number prefer valueOf, template literals and String prefer toString", async () => {
    expect(
      await value(`
        const both = { valueOf() { return 1 }, toString() { return "s" } }
        return [both + "", \`\${both}\`, String(both), both * 2, new Error(both).message, [both].join(), [both, 2] + ""]
      `),
    ).toEqual(["1", "s", "s", 2, "s", "s", "s,2"])
  })

  test("operands convert left then right, and a throwing valueOf surfaces as the program error", async () => {
    expect(
      await value(`
        const order = []
        const a = { valueOf() { order.push("a"); return 1 } }, b = { valueOf() { order.push("b"); return 2 } }
        a + b; a < b; a - b
        return order
      `),
    ).toEqual(["a", "b", "a", "b", "a", "b"])
    expect(
      await value(`
        const bad = { valueOf() { throw new RangeError("nope") } }
        const names = []
        try { bad + 1 } catch (e) { names.push(e.name) }
        try { Number(bad) } catch (e) { names.push(e.name) }
        try { Math.abs(bad) } catch (e) { names.push(e.name) }
        return names
      `),
    ).toEqual(["RangeError", "RangeError", "RangeError"])
  })

  test("arrays keep their built-in join form unless the program replaces toString", async () => {
    expect(
      await value(`
        const arr = [1, 2]
        const before = [arr + "", [] + [], [1, , 3].join("-"), [1, { toString() { return "q" } }].join("-")]
        arr.toString = () => "x"
        return [...before, arr + "", \`\${arr}\`, String(arr)]
      `),
    ).toEqual(["1,2", "", "1--3", "1-q", "x", "x", "x"])
  })

  test("update and compound assignment convert the current value", async () => {
    expect(
      await value(`
        let x = { valueOf() { return 5 } }
        const o = { n: { valueOf() { return 4 } } }
        const after = x++
        o.n += 1
        o.n++
        let s = { valueOf() { return 2 } }
        s *= 3
        return [after, x, o.n, s]
      `),
    ).toEqual([5, 6, 6, 6])
  })

  test("functions and other opaque values still reject arithmetic, and an object without a primitive form throws", async () => {
    expect((await error(`const f = () => 1; return f + 1`)).message).toContain("Binary operators require data values")
    expect((await error(`return -(() => 1)`)).message).toContain("Unary operators require data values")
    const failure = await error(`return { valueOf() { return {} }, toString() { return [] } } + 1`)
    expect(failure.message).toContain("Cannot convert object to primitive value")
  })
})
