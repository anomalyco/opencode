import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Rune } from "@/session/rune/rune"

// Runs a Rune program with no host tools and returns the ExecuteResult. These tests pin the
// JS-parity fixes for the "99% of ordinary defensive JavaScript just works" goal: cases where
// Rune used to throw but idiomatic JS yields undefined / succeeds.
const run = (code: string) => Effect.runPromise(Rune.execute({ code, tools: {} }))
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
    expect(await value(`const s = "hi"; return s.login`)).toBeUndefined()
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
    expect(await value(`return [1,2,3].foo`)).toBeUndefined()
  })

  test("optional chaining on an array does not throw", async () => {
    expect(await value(`return [1,2,3]?.foo ?? "fb"`)).toBe("fb")
  })

  test("real-but-unsupported array methods still give the rewrite hint", async () => {
    const err = await error(`return [1,2,3].splice(0,1)`)
    expect(err.kind).toBe("UnsupportedSyntax")
    expect(err.message).toContain("splice")
  })

  test("supported array methods and indexing still work", async () => {
    expect(await value(`return [1,2,3].map(x => x + 1)`)).toEqual([2, 3, 4])
    expect(await value(`return [1,2,3][9]`)).toBeUndefined()
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
