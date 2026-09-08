import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../src/index.js"
import { ToolRuntime } from "../src/tool-runtime.js"

// Runs a CodeMode program with no host tools and returns the CodeMode.Result. These tests pin the
// JS-parity behaviors for the "99% of ordinary defensive JavaScript just works" goal: cases where
// a strict interpreter would throw but idiomatic JS yields undefined / succeeds.
//
// Note on the result boundary: this package normalizes a bare `undefined` result to `null` when
// it crosses out of the sandbox (results are JSON data), so tests asserting an in-sandbox
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

  test("supported string methods still work", async () => {
    expect(await value(`return "AB".toLowerCase()`)).toBe("ab")
    expect(await value(`return "hello".length`)).toBe(5)
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
    expect(await value(`return [1,2,3].toSpliced === undefined`)).toBe(true)
  })

  test("supported array methods and indexing still work", async () => {
    expect(await value(`return [1,2,3].map(x => x + 1)`)).toEqual([2, 3, 4])
    expect(await value(`return [1,2,3][9] === undefined`)).toBe(true)
    expect(await value(`return [1,2,3][9]`)).toBeNull()
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

  test("spreading an array into an object still errors", async () => {
    const err = await error(`return { ...[1,2], a: 1 }`)
    expect(err.kind).toBe("InvalidDataValue")
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

describe("H1: NaN/Infinity flow as intermediates and normalize to null at the boundary", () => {
  test("guards run instead of the program crashing on a transient NaN", async () => {
    expect(await value(`return parseInt("abc") || 0`)).toBe(0)
    expect(await value(`const x = Number("abc"); return Number.isNaN(x) ? 0 : x`)).toBe(0)
    expect(await value(`const o = {}; o.count = (o.count || 0) + 1; return o.count`)).toBe(1)
    // average of an empty list, guarded - the classic divide-by-zero that used to throw pre-guard
    expect(await value(`const a = []; return a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0`)).toBe(0)
  })

  test("a non-finite value becomes null when it leaves the sandbox", async () => {
    expect(await value(`return 5/0`)).toBeNull()
    expect(await value(`return 0/0`)).toBeNull()
    expect(await value(`return Math.max()`)).toBeNull()
    // nested, too - normalization walks the returned structure
    expect(await value(`return { a: Number("x"), b: 2, c: [1/0] }`)).toEqual({ a: null, b: 2, c: [null] })
  })

  test("NaN and Infinity are usable identifiers and inspectable in-sandbox", async () => {
    expect(await value(`return Number.isNaN(NaN)`)).toBe(true)
    expect(await value(`return Infinity > 1e9`)).toBe(true)
    expect(await value(`return Number.isFinite(1/0)`)).toBe(false)
    expect(await value(`return [3,1,2].reduce((a,b)=>Math.max(a,b), -Infinity)`)).toBe(3)
    // JSON.stringify inside the sandbox matches JS: non-finite serializes to null
    expect(await value(`return JSON.stringify({ x: Number("z") })`)).toBe('{"x":null}')
  })

  test("copyOut normalizes non-finite numbers to null (the shared return + tool-arg boundary)", () => {
    // Tool-call arguments funnel through copyOut too, so this one function pins both boundaries.
    expect(ToolRuntime.copyOut(NaN)).toBeNull()
    expect(ToolRuntime.copyOut(Infinity)).toBeNull()
    expect(ToolRuntime.copyOut(-Infinity)).toBeNull()
    expect(ToolRuntime.copyOut(42)).toBe(42)
    expect(ToolRuntime.copyOut({ a: NaN, b: [Infinity, 1] })).toEqual({ a: null, b: [null, 1] })
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
    expect(await value(`try { "a".normalize("NOPE") } catch (e) { return [e.name, e instanceof RangeError] }`)).toEqual(
      ["RangeError", true],
    )
    expect(await value(`try { "a".match("(") } catch (e) { return [e.name, e instanceof SyntaxError] }`)).toEqual([
      "SyntaxError",
      true,
    ])
    expect(await value(`try { new RegExp("(") } catch (e) { return [e.name, e instanceof SyntaxError] }`)).toEqual([
      "SyntaxError",
      true,
    ])
  })

  test("diagnostics without a specific real-JS analogue are named plain Error", async () => {
    expect(await value(`try { JSON.parse(5) } catch (e) { return [e.name, e instanceof Error] }`)).toEqual([
      "Error",
      true,
    ])
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

  test("error values still serialize as plain { name, message } data", async () => {
    expect(await value(`return new Error("m")`)).toEqual({ name: "Error", message: "m" })
    expect(await value(`return JSON.stringify(new Error("m"))`)).toBe('{"name":"Error","message":"m"}')
    expect(await value(`try { throw new Error("m") } catch (e) { return Object.keys(e) }`)).toEqual(["name", "message"])
  })

  test("spreading an error loses the brand, like losing the prototype in JS", async () => {
    expect(await value(`const e = new Error("m"); return ({ ...e }) instanceof Error`)).toBe(false)
    expect(await value(`const e = new Error("m"); return { ...e }`)).toEqual({ name: "Error", message: "m" })
  })

  test("typeof Error is function; an unknown instanceof right-hand side is a catchable error", async () => {
    expect(await value(`return typeof Error`)).toBe("function")
    expect(await value(`try { return 1 instanceof 5 } catch (e) { return "caught" }`)).toBe("caught")
    const err = await error(`return 1 instanceof 5`)
    expect(err.message).toContain("right-hand side of 'instanceof'")
  })
})

describe("array methods: splice, fill, copyWithin, keys/values/entries", () => {
  test("splice removes in place and returns the removed elements", async () => {
    expect(await value(`const a = [1,2,3,4]; const removed = a.splice(1, 2); return { removed, a }`)).toEqual({
      removed: [2, 3],
      a: [1, 4],
    })
  })

  test("splice inserts new elements at the cut", async () => {
    expect(await value(`const a = ["a","d"]; a.splice(1, 0, "b", "c"); return a`)).toEqual(["a", "b", "c", "d"])
    expect(await value(`const a = [1,2,3]; const removed = a.splice(1, 1, "x"); return { removed, a }`)).toEqual({
      removed: [2],
      a: [1, "x", 3],
    })
  })

  test("splice with one argument removes to the end; negative start counts back", async () => {
    expect(await value(`const a = [1,2,3]; const removed = a.splice(1); return { removed, a }`)).toEqual({
      removed: [2, 3],
      a: [1],
    })
    expect(await value(`const a = [1,2,3]; const removed = a.splice(-1); return { removed, a }`)).toEqual({
      removed: [3],
      a: [1, 2],
    })
  })

  test("splice rejects inserting a container into itself", async () => {
    const err = await error(`const a = [1]; a.splice(0, 0, [a]); return a`)
    expect(err.kind).toBe("InvalidDataValue")
    expect(err.message).toContain("circular")
  })

  test("fill overwrites a range and returns the mutated array", async () => {
    expect(await value(`const a = [1,2,3,4]; return a.fill(0, 1, 3)`)).toEqual([1, 0, 0, 4])
    expect(await value(`return [1,2,3].fill("z")`)).toEqual(["z", "z", "z"])
  })

  test("copyWithin copies a range in place", async () => {
    expect(await value(`return [1,2,3,4,5].copyWithin(0, 3)`)).toEqual([4, 5, 3, 4, 5])
  })

  test("keys/values/entries return arrays usable with for...of and spread", async () => {
    expect(await value(`return [...["x","y","z"].keys()]`)).toEqual([0, 1, 2])
    expect(await value(`return ["x","y"].values()`)).toEqual(["x", "y"])
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

describe("string methods: localeCompare, normalize, trim aliases", () => {
  test("localeCompare orders strings for sorting", async () => {
    expect(await value(`return ["b","a","c"].sort((x, y) => x.localeCompare(y))`)).toEqual(["a", "b", "c"])
    expect(await value(`return "a".localeCompare("a")`)).toBe(0)
  })

  test("normalize applies unicode normalization forms", async () => {
    expect(await value(`return "\\u0065\\u0301".normalize("NFC").length`)).toBe(1)
    expect(await value(`return "\\u00e9".normalize("NFD").length`)).toBe(2)
    expect(await value(`return "x".normalize() === "x"`)).toBe(true)
  })

  test("an invalid normalize form is a clear catchable error", async () => {
    expect(await value(`try { "x".normalize("nope"); return "no" } catch (e) { return e.message }`)).toContain('"NFC"')
  })

  test("trimLeft/trimRight alias trimStart/trimEnd", async () => {
    expect(await value(`return "  x ".trimLeft()`)).toBe("x ")
    expect(await value(`return "  x ".trimRight()`)).toBe("  x")
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

  test("sandbox Date += concatenates its string form, like d = d + 1", async () => {
    const result = await pair(`let d = new Date(1000); d += 1; return d`, `let d = new Date(1000); d = d + 1; return d`)
    expect(result).toBe("1970-01-01T00:00:01.000Z1")
  })

  test("sandbox Date numeric compound ops use its time value", async () => {
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

  test("arrow callbacks still work (no regression)", async () => {
    expect(await value(`return [1, 2, 3, 4].filter(x => x % 2 === 0)`)).toEqual([2, 4])
    expect(await value(`return [1, 2, 3].reduce((a, b) => a + b, 0)`)).toBe(6)
  })

  test("a non-callable callback is still rejected", async () => {
    const err = await error(`return [1,2,3].map(42)`)
    expect(err.message).toContain("callback")
  })
})
