/*
 * Portions adapted from Test262 at revision 250f204f23a9249ff204be2baec29600faae7b75:
 * - test/built-ins/Date/value-to-primitive-result-non-string-prim.js
 * - test/built-ins/Date/value-to-primitive-result-string.js
 * - test/built-ins/Date/prototype/toUTCString/format.js
 * - test/built-ins/Date/prototype/toUTCString/invalid-date.js
 * - test/built-ins/RegExp/prototype/exec/S15.10.6.2_A4_T8.js
 *
 * CodeMode does not support Symbol.toPrimitive, so the Date-constructor cases exercise the same primitive-result
 * handling through supported own valueOf and toString functions.
 *
 * Copyright (C) 2016 the V8 project authors. All rights reserved.
 * Copyright (C) 2017 the V8 project authors. All rights reserved.
 * Copyright 2009 the Sputnik authors. All rights reserved.
 * Test262 portions are governed by the BSD license in LICENSE.test262.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"

// Standard-library value types: Date, RegExp, Map, Set. Programs use them as ordinary JS;
// intra-CodeMode checkpoints (Object.* helpers, spread, coercion inputs) preserve the live
// values. JSON.stringify keeps Date -> ISO string (invalid -> null), URL -> href, and
// RegExp/Map/Set/URLSearchParams -> {}. The host boundary matches that except URLSearchParams,
// which cross as their query string, and Set, which crosses as an array.
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

describe("Number and Math", () => {
  test("Math.random returns a number in [0, 1)", async () => {
    expect(await value(`const n = Math.random(); return typeof n === "number" && n >= 0 && n < 1`)).toBe(true)
  })

  test("Number exposes native non-finite constants", async () => {
    expect(
      await value(
        `return [Number.isNaN(Number.NaN), Number.POSITIVE_INFINITY === Infinity, Number.NEGATIVE_INFINITY === -Infinity]`,
      ),
    ).toEqual([true, true, true])
  })

  test("Number valueOf returns its primitive receiver", async () => {
    expect(await value(`return (42).valueOf()`)).toBe(42)
  })

  test("Number valueOf does not enable boxed numbers", async () => {
    const failure = await error(`return new Number(42)`)
    expect(failure.kind).toBe("ExecutionFailure")
    expect(failure.message).toContain("new Number(...) is not supported; call Number(...) without new instead.")
  })
})

describe("Date", () => {
  test("Date.now() returns a number", async () => {
    expect(await value(`return typeof Date.now()`)).toBe("number")
  })

  test("epoch construction and ISO rendering", async () => {
    expect(await value(`return new Date(0).toISOString()`)).toBe("1970-01-01T00:00:00.000Z")
  })

  test("string parsing round-trips", async () => {
    expect(await value(`return new Date("2024-01-02T03:04:05.000Z").getTime()`)).toBe(1704164645000)
    expect(await value(`return Date.parse("2024-01-02T03:04:05.000Z")`)).toBe(1704164645000)
  })

  test("one-argument construction coerces supported values like JavaScript", async () => {
    expect(
      await value(`return [new Date(true).getTime(), new Date(false).getTime(), new Date(null).getTime()]`),
    ).toEqual([1, 0, 0])
    expect(await value(`return Number.isNaN(new Date(undefined).getTime())`)).toBe(true)
    expect(await value(`return Number.isNaN(new Date([]).getTime())`)).toBe(true)
    expect(await value(`return new Date(["1970-01-01T00:00:00.000Z"]).getTime()`)).toBe(0)
    expect(await value(`return Number.isNaN(new Date({}).getTime())`)).toBe(true)
  })

  test("one-argument construction uses valueOf then toString for objects", async () => {
    expect(
      await value(`
        const calls = []
        const number = { valueOf: () => 8 }
        const text = {
          valueOf: () => { calls.push("valueOf"); return {} },
          toString: () => { calls.push("toString"); return "2016-06-05T18:40:00.000Z" },
        }
        return [new Date(number).getTime(), new Date(text).getTime(), calls]
      `),
    ).toEqual([8, 1465152000000, ["valueOf", "toString"]])

    expect(
      await value(`
        const values = [
          { valueOf: () => undefined },
          { valueOf: () => true },
          { valueOf: () => false },
          { valueOf: () => null },
        ]
        return values.map((item) => new Date(item).getTime())
      `),
    ).toEqual([null, 1, 0, 0])

    expect(
      await value(`
        try {
          new Date({ valueOf: () => ({}), toString: () => ({}) })
        } catch (error) {
          return error.name
        }
      `),
    ).toBe("TypeError")
  })

  test("date arithmetic and comparison use the time value", async () => {
    expect(await value(`const a = new Date(1000); const b = new Date(3000); return b - a`)).toBe(2000)
    expect(await value(`const a = new Date(1000); const b = new Date(3000); return a < b`)).toBe(true)
    expect(await value(`return +new Date(42)`)).toBe(42)
  })

  test("UTC getters read calendar components", async () => {
    expect(
      await value(
        `const d = new Date("2024-03-05T06:07:08.009Z"); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()]`,
      ),
    ).toEqual([2024, 2, 5, 6, 7, 8, 9])
  })

  test("invalid dates yield NaN times, guardable in-CodeMode", async () => {
    expect(await value(`return Number.isNaN(new Date("garbage").getTime())`)).toBe(true)
    expect(await value(`return new Date("garbage").toJSON()`)).toBeNull()
  })

  test("toISOString on an invalid date throws RangeError", async () => {
    expect(await value(`try { new Date("garbage").toISOString() } catch (error) { return error.name }`)).toBe(
      "RangeError",
    )
  })

  test("template interpolation renders the ISO form", async () => {
    expect(await value("return `at ${new Date(0)}`")).toBe("at 1970-01-01T00:00:00.000Z")
  })

  test("dates serialize to ISO strings at the boundary, direct and nested", async () => {
    expect(await value(`return new Date(0)`)).toBe("1970-01-01T00:00:00.000Z")
    expect(await value(`return { when: new Date(0), tags: [new Date(1000)] }`)).toEqual({
      when: "1970-01-01T00:00:00.000Z",
      tags: ["1970-01-01T00:00:01.000Z"],
    })
    expect(await value(`return JSON.stringify({ d: new Date(0) })`)).toBe('{"d":"1970-01-01T00:00:00.000Z"}')
  })

  test("coercions: Number is the time, String is ISO, Boolean is true", async () => {
    expect(await value(`return Number(new Date(5))`)).toBe(5)
    expect(await value(`return String(new Date(0))`)).toBe("1970-01-01T00:00:00.000Z")
    expect(await value(`return Boolean(new Date(0))`)).toBe(true)
  })

  test("sorting dates with a numeric comparator", async () => {
    expect(
      await value(`
      const dates = [new Date(3000), new Date(1000), new Date(2000)]
      return dates.sort((a, b) => a - b).map((d) => d.getTime())
    `),
    ).toEqual([1000, 2000, 3000])
  })

  test("new Date(year, month, day) accepts component form", async () => {
    expect(await value(`const d = new Date(2024, 0, 2); return [d.getFullYear(), d.getMonth(), d.getDate()]`)).toEqual([
      2024, 0, 2,
    ])
  })

  test("typeof and unknown properties are forgiving", async () => {
    expect(await value(`return typeof new Date(0)`)).toBe("object")
    expect(await value(`return new Date(0).nope === undefined`)).toBe(true)
  })

  test("toUTCString and toGMTString use the native UTC format", async () => {
    expect(
      await value(`
        const date = new Date(0)
        return [
          date.toUTCString(),
          date.toGMTString(),
          new Date(NaN).toUTCString(),
          new Date("0020-01-01T00:00:00Z").toUTCString(),
        ]
      `),
    ).toEqual([
      "Thu, 01 Jan 1970 00:00:00 GMT",
      "Thu, 01 Jan 1970 00:00:00 GMT",
      "Invalid Date",
      "Wed, 01 Jan 0020 00:00:00 GMT",
    ])
  })
})

describe("RegExp", () => {
  test("literal test", async () => {
    expect(await value(`return /ab+c/.test("xabbbc")`)).toBe(true)
    expect(await value(`return /ab+c/.test("nope")`)).toBe(false)
  })

  test("exec exposes captures and index", async () => {
    expect(await value(`const m = /a(b+)/.exec("xxabbc"); return { full: m[0], group: m[1], index: m.index }`)).toEqual(
      {
        full: "abb",
        group: "bb",
        index: 2,
      },
    )
    expect(await value(`return /a/.exec("zzz")`)).toBeNull()
  })

  test("named groups read through", async () => {
    expect(
      await value(`const m = /(?<word>[a-z]+)-(?<num>\\d+)/.exec("id ab-42"); return m.groups.word + m.groups.num`),
    ).toBe("ab42")
  })

  test("global exec advances lastIndex across calls", async () => {
    expect(
      await value(`
      const r = /\\d+/g
      const first = r.exec("a1b22c")
      const second = r.exec("a1b22c")
      return [first[0], second[0]]
    `),
    ).toEqual(["1", "22"])
  })

  test("lastIndex is writable and stores a number", async () => {
    expect(
      await value(`
        const pattern = /(?:ab|cd)\\d?/g
        pattern.lastIndex = "12"
        const stored = [pattern.lastIndex, typeof pattern.lastIndex]
        const match = pattern.exec("aacd2233ab12nm444ab42")
        pattern.lastIndex = 0
        return [stored, match[0], match.index, pattern.lastIndex]
      `),
    ).toEqual([[12, "number"], "ab4", 17, 0])
    // lastIndex is a prototype accessor, so delete is a no-op rather than a TypeError.
    expect(await value(`const re = /a/; return [delete re.lastIndex, re.lastIndex]`)).toEqual([true, 0])
  })

  test("a non-numeric lastIndex runs from 0; non-global exec and test leave it alone", async () => {
    expect(
      await value(`
        const pattern = /a/g
        pattern.lastIndex = {}
        const match = pattern.exec("ba")
        pattern.lastIndex = 10
        const missed = pattern.exec("a")
        const plain = /a/
        plain.lastIndex = 5
        return [match.index, pattern.lastIndex, missed, plain.exec("ba").index, plain.test("ba"), plain.lastIndex]
      `),
    ).toEqual([1, 0, null, 1, true, 5])
  })

  test("String methods read and update lastIndex like exec", async () => {
    expect(
      await value(`
        const re = /a/y
        re.exec("aa")
        re.lastIndex = 0
        return ["aa".replace(re, "b"), re.lastIndex]
      `),
    ).toEqual(["ba", 1])
    expect(
      await value(`
        const re = /a/g
        re.exec("aaa")
        return ["aaa".match(re), re.lastIndex]
      `),
    ).toEqual([["a", "a", "a"], 0])
    expect(
      await value(`
        const re = /a/g
        re.lastIndex = 2
        return ["aaa".replace(re, () => "b"), re.lastIndex]
      `),
    ).toEqual(["bbb", 0])
    expect(
      await value(`
        const re = /a/g
        re.lastIndex = 2
        return ["aaa".replaceAll(re, "b"), re.lastIndex]
      `),
    ).toEqual(["bbb", 0])
    expect(
      await value(`
        const re = /a/y
        re.lastIndex = 1
        const m = "baa".match(re)
        return [m.index, re.lastIndex]
      `),
    ).toEqual([1, 2])
  })

  test("split, search, and matchAll leave lastIndex unchanged like JS", async () => {
    expect(
      await value(`
        const re = /a/y
        re.lastIndex = 2
        return ["banana".split(re), re.lastIndex]
      `),
    ).toEqual([["b", "n", "n", ""], 2])
    expect(
      await value(`
        const re = /a/g
        re.lastIndex = 2
        return ["banana".search(re), re.lastIndex]
      `),
    ).toEqual([1, 2])
    expect(
      await value(`
        const re = /a/y
        re.lastIndex = 2
        return ["banana".search(re), re.lastIndex]
      `),
    ).toEqual([-1, 2])
    expect(
      await value(`
        const re = /a/g
        re.lastIndex = 2
        return ["banana".matchAll(re).map((m) => m.index), re.lastIndex]
      `),
    ).toEqual([[3, 5], 2])
    expect(
      await value(`
        const re = /a/gy
        re.lastIndex = 1
        return ["banana".matchAll(re).map((m) => m.index), re.lastIndex]
      `),
    ).toEqual([[1], 1])
  })

  test("String methods leave lastIndex untouched without g or y", async () => {
    expect(
      await value(`
        const re = /a/
        re.lastIndex = 5
        return ["aaa".replace(re, "b"), "aaa".match(re).index, "aaa".split(re), "aaa".search(re), re.lastIndex]
      `),
    ).toEqual(["baa", 0, ["", "", "", ""], 0, 5])
  })

  test("an unmatched string pattern returns null", async () => {
    expect(await value(`return "abc".match(/\\d/)`)).toBeNull()
  })

  test("matchAll materializes match arrays with captures", async () => {
    expect(await value(`return "a1b22".matchAll(/(\\d+)/g).map((m) => m[1])`)).toEqual(["1", "22"])
  })

  test("function replacers receive captures, offsets, input, and named groups", async () => {
    expect(
      await value(`
        const seen = []
        const output = "a1b22".replace(/(\\d)(\\d)?/g, (match, first, second, offset, input) => {
          seen.push([match, first, second === undefined, offset, input])
          return Number(match) * 2
        })
        return { output, seen }
      `),
    ).toEqual({
      output: "a2b44",
      seen: [
        ["1", "1", true, 1, "a1b22"],
        ["22", "2", false, 3, "a1b22"],
      ],
    })
    expect(
      await value(`
        return "red-blue".replace(
          /(?<left>[a-z]+)-(?<right>[a-z]+)/,
          (match, left, right, offset, input, groups) => groups.right + ":" + groups.left,
        )
      `),
    ).toBe("blue:red")
  })

  test("function replacers support string searches, zero-length matches, and result coercion", async () => {
    expect(await value(`return "banana".replace("na", (match, offset, input) => "[" + offset + "]")`)).toBe("ba[2]na")
    expect(await value(`return "ab".replaceAll("", (match, offset) => offset)`)).toBe("0a1b2")
    expect(await value(`return "😀".replaceAll(/(?:)/gu, (match, offset) => "[" + offset + "]")`)).toBe("[0]😀[2]")
    expect(
      await value(`return "123".replace(/\\d/g, (match) => match === "1" ? 7 : match === "2" ? null : { n: 3 })`),
    ).toBe("7null[object Object]")
  })

  test("promise-returning string replacers are coerced synchronously", async () => {
    const decorate = Tool.make({
      description: "Decorate a string",
      input: Schema.String,
      output: Schema.String,
      execute: (input) => Effect.succeed(`[${input}]`),
    })
    const result = await Effect.runPromise(
      CodeMode.execute({
        tools: { host: { decorate } },
        code: `return "a1b22".replace(/\\d+/g, async (match) => await tools.host.decorate(match))`,
      }),
    )
    expect(result.ok && result.value).toBe("a[object Promise]b[object Promise]")

    const missingAwait = await Effect.runPromise(
      CodeMode.execute({
        tools: { host: { decorate } },
        code: `return "a1".replace(/\\d/, (match) => tools.host.decorate(match))`,
      }),
    )
    expect(missingAwait.ok && missingAwait.value).toBe("a[object Promise]")
  })

  test("replaceAll without the g flag is a catchable error", async () => {
    expect(await value(`try { "a".replaceAll(/a/, "b"); return "no" } catch { return "caught" }`)).toBe("caught")
  })

  test("new RegExp constructs from strings; invalid patterns are catchable", async () => {
    expect(await value(`return new RegExp("a+", "i").test("AAA")`)).toBe(true)
    expect(await value(`try { new RegExp("("); return "no" } catch { return "caught" }`)).toBe("caught")
    expect(await value(`return [/a/ instanceof RegExp, /a/.source]`)).toEqual([true, "a"])
  })

  test("invalid patterns fail with actionable messages", async () => {
    const fromString = await error(`return "abc".match("(")`)
    expect(fromString.message).toContain('String.match received the string "("')
    expect(fromString.message).toContain("escape them with a backslash")

    const fromConstructor = await error(`return new RegExp("(")`)
    expect(fromConstructor.message).toContain('new RegExp(...) received "("')
    expect(fromConstructor.message).toContain("escape them with a backslash")

    const fromFlags = await error(`return new RegExp("a", "xz")`)
    expect(fromFlags.message).toContain('invalid flags "xz"')
    expect(fromFlags.message).toContain("Valid flags are")
  })

  test("missing g-flag errors say how to fix the call", async () => {
    expect((await error(`return "aa".replaceAll(/a/, "b")`)).message).toContain("write /a/g, or use String.replace")
    expect((await error(`return "aa".matchAll(/a/)`)).message).toContain("write /a/g, or use String.match")
  })

  test("any argument is a pattern string, as new RegExp(arg) reads it", async () => {
    expect(
      await value(
        `return ["a42b".match(42)[0], "xnullx".search(null), "abc".match(undefined), [..."1a1".matchAll(1)].length]`,
      ),
    ).toEqual(["42", 1, [""], 2])
  })

  test("source and flags properties read through", async () => {
    expect(await value(`const r = /ab/gi; return { source: r.source, flags: r.flags, global: r.global }`)).toEqual({
      source: "ab",
      flags: "gi",
      global: true,
    })
  })

  test("regexes serialize as {} like JSON.stringify, at the boundary and inside the program", async () => {
    expect(await value(`return [/a/, { r: /b/gi }]`)).toEqual([{}, { r: {} }])
    expect(await value(`return JSON.stringify({ r: /a/g })`)).toBe('{"r":{}}')
  })

  test("template interpolation renders the literal form", async () => {
    expect(await value("return `${/ab/g}`")).toBe("/ab/g")
  })
})

describe("URL and URI helpers", () => {
  test("encodes and decodes complete URIs and URI components", async () => {
    expect(
      await value(`
        return [
          encodeURI("https://example.test/a b?q=a/b"),
          encodeURIComponent("a b/c?"),
          decodeURI("https://example.test/a%20b?q=a/b"),
          decodeURIComponent("a%20b%2Fc%3F"),
          ["a b", "c/d"].map(encodeURIComponent),
        ]
      `),
    ).toEqual([
      "https://example.test/a%20b?q=a/b",
      "a%20b%2Fc%3F",
      "https://example.test/a b?q=a/b",
      "a b/c?",
      ["a%20b", "c%2Fd"],
    ])
    expect(
      await value(`try { decodeURIComponent("%zz"); return false } catch (error) { return error instanceof URIError }`),
    ).toBe(true)
  })

  test("resolves and mutates URLs with linked search parameters", async () => {
    expect(
      await value(`
        const url = new URL("../users?id=old#top", "https://user:pass@example.com:8443/api/v1/")
        url.pathname = "/items/a b"
        url.searchParams.set("id", "a b")
        url.searchParams.append("tag", "x/y")
        url.hash = "part 1"
        return {
          href: url.href,
          origin: url.origin,
          host: url.host,
          pathname: url.pathname,
          search: url.search,
          id: url.searchParams.get("id"),
          string: String(url),
          json: url.toJSON(),
          instances: [
            url instanceof URL,
            url.searchParams instanceof URLSearchParams,
            url.searchParams === url.searchParams,
          ],
        }
      `),
    ).toEqual({
      href: "https://user:pass@example.com:8443/items/a%20b?id=a+b&tag=x%2Fy#part%201",
      origin: "https://example.com:8443",
      host: "example.com:8443",
      pathname: "/items/a%20b",
      search: "?id=a+b&tag=x%2Fy",
      id: "a b",
      string: "https://user:pass@example.com:8443/items/a%20b?id=a+b&tag=x%2Fy#part%201",
      json: "https://user:pass@example.com:8443/items/a%20b?id=a+b&tag=x%2Fy#part%201",
      instances: [true, true, true],
    })
  })

  test("URLSearchParams supports records, pairs, mutation, callbacks, and materialization", async () => {
    expect(
      await value(`
        const params = new URLSearchParams([["tag", "b"], ["tag", "a"], ["q", "a b"]])
        const seen = []
        params.forEach((value, key) => seen.push(key + "=" + value))
        params.delete("tag", "b")
        params.append("tag", "c")
        params.sort()
        return {
          text: params.toString(),
          size: params.size,
          tags: params.getAll("tag"),
          has: params.has("tag", "c"),
          entries: Array.from(params),
          object: Object.fromEntries(params),
          record: new URLSearchParams({ page: 2, filter: "open" }).toString(),
          seen,
        }
      `),
    ).toEqual({
      text: "q=a+b&tag=a&tag=c",
      size: 3,
      tags: ["a", "c"],
      has: true,
      entries: [
        ["q", "a b"],
        ["tag", "a"],
        ["tag", "c"],
      ],
      object: { q: "a b", tag: "c" },
      record: "page=2&filter=open",
      seen: ["tag=b", "tag=a", "q=a b"],
    })
  })

  test("URL parsing failures are catchable and values use native JSON forms", async () => {
    expect(
      await value(`
        const parsed = URL.parse("/users", "https://example.test/api/")
        let invalidIsTypeError = false
        try { new URL("not relative without a base") } catch (error) { invalidIsTypeError = error instanceof TypeError }
        return {
          canParse: URL.canParse("/users", "https://example.test/api/"),
          cannotParse: URL.canParse("not relative without a base"),
          parsed: parsed.href,
          invalidIsTypeError,
          boundary: [new URL("https://example.test/a"), new URLSearchParams("q=one")],
          json: JSON.stringify({ url: new URL("https://example.test/a"), params: new URLSearchParams("q=one") }),
        }
      `),
    ).toEqual({
      canParse: true,
      cannotParse: false,
      parsed: "https://example.test/users",
      invalidIsTypeError: true,
      boundary: ["https://example.test/a", "q=one"],
      json: '{"url":"https://example.test/a","params":{}}',
    })
  })

  test("distinguishes omitted URL arguments from explicit undefined", async () => {
    expect(
      await value(`
        function throwsTypeError(run) {
          try { run(); return false } catch (error) { return error instanceof TypeError }
        }
        const params = new URLSearchParams()
        const required = [
          () => params.append(),
          () => params.delete(),
          () => params.get(),
          () => params.getAll(),
          () => params.has(),
          () => params.set(),
          () => params.forEach(),
        ].map(throwsTypeError)
        params.append(undefined, undefined)
        return {
          construct: throwsTypeError(() => new URL()),
          canParse: throwsTypeError(() => URL.canParse()),
          parse: throwsTypeError(() => URL.parse()),
          explicitUndefined: new URL(undefined, "https://example.test/base/").href,
          params: params.toString(),
          required,
        }
      `),
    ).toEqual({
      construct: true,
      canParse: true,
      parse: true,
      explicitUndefined: "https://example.test/base/undefined",
      params: "undefined=undefined",
      required: [true, true, true, true, true, true, true],
    })
  })
})

describe("Headers", () => {
  test("constructs from records, pairs, Maps, and Headers; names fold to lowercase and values combine", async () => {
    expect(
      await value(`
        const headers = new Headers({ "Content-Type": "text/plain", "X-Count": 1, "X-Null": null })
        headers.append("Accept", "text/html")
        headers.append("accept", "application/json")
        headers.set("x-count", "2")
        headers.delete("x-null")
        const copy = new Headers(headers)
        copy.set("content-type", "text/html")
        return {
          get: headers.get("content-type"),
          missing: headers.get("x-missing"),
          combined: headers.get("ACCEPT"),
          has: [headers.has("Accept"), headers.has("x-null")],
          count: headers.get("x-count"),
          copied: [headers.get("content-type"), copy.get("content-type")],
          pairs: [...new Headers([["b", "2"], ["A", "1"]])],
          map: [...new Headers(new Map([["k", "v"]]))],
          keys: [...headers.keys()],
          values: [...headers.values()],
          entries: [...headers.entries()],
        }
      `),
    ).toEqual({
      get: "text/plain",
      missing: null,
      combined: "text/html, application/json",
      has: [true, false],
      count: "2",
      copied: ["text/plain", "text/html"],
      pairs: [
        ["a", "1"],
        ["b", "2"],
      ],
      map: [["k", "v"]],
      keys: ["accept", "content-type", "x-count"],
      values: ["text/html, application/json", "text/plain", "2"],
      entries: [
        ["accept", "text/html, application/json"],
        ["content-type", "text/plain"],
        ["x-count", "2"],
      ],
    })
  })

  test("iterates in sorted order everywhere iteration is allowed, and getSetCookie keeps cookies apart", async () => {
    expect(
      await value(`
        const headers = new Headers({ b: "2", a: "1" })
        headers.append("Set-Cookie", "x=1")
        headers.append("set-cookie", "y=2")
        const seen = []
        headers.forEach((value, name, self) => seen.push(name + "=" + value + ":" + (self === headers)))
        const [first] = headers
        function* pairs() { yield* headers }
        return {
          seen,
          first,
          spread: [...headers],
          from: Array.from(headers).length,
          generator: [...pairs()].length,
          object: Object.fromEntries(headers),
          cookies: headers.getSetCookie(),
        }
      `),
    ).toEqual({
      seen: ["a=1:true", "b=2:true", "set-cookie=x=1:true", "set-cookie=y=2:true"],
      first: ["a", "1"],
      spread: [
        ["a", "1"],
        ["b", "2"],
        ["set-cookie", "x=1"],
        ["set-cookie", "y=2"],
      ],
      from: 4,
      generator: 4,
      object: { a: "1", b: "2", "set-cookie": "y=2" },
      cookies: ["x=1", "y=2"],
    })
  })

  test("serializes as a name-to-value object at the boundary and in JSON; prints for console", async () => {
    const result = await run(`
      const headers = new Headers({ "X-A": "1", b: "2" })
      console.log(headers)
      return { headers, json: JSON.stringify({ headers }), text: String(headers), type: typeof headers, is: headers instanceof Headers }
    `)
    expect(result.ok && result.value).toEqual({
      headers: { b: "2", "x-a": "1" },
      json: '{"headers":{"b":"2","x-a":"1"}}',
      text: "[object Headers]",
      type: "object",
      is: true,
    })
    expect(result.ok && result.logs?.[0]).toBe('Headers {"b":"2","x-a":"1"}')
  })

  test("rejects what it cannot build from, and invalid names and values, with TypeErrors the program can catch", async () => {
    expect(
      await value(`
        function message(run) {
          try { run(); return null } catch (error) { return error instanceof TypeError ? error.message : error }
        }
        const headers = new Headers()
        return [
          message(() => Headers()),
          message(() => new Headers(null)),
          message(() => new Headers(1)),
          message(() => new Headers("a=1")),
          message(() => new Headers(new Date())),
          message(() => new Headers(() => 1)),
          message(() => new Headers([["name"]])),
          message(() => new Headers([["a", "b", "c"]])),
          message(() => new Headers({ "bad name": "x" })),
          message(() => new Headers({ name: "bad\u0000value" })),
          message(() => headers.get("invalid\u0100")),
          message(() => headers.has({})),
          message(() => headers.set("a", "invalid\u0100")),
          message(() => headers.append("a")),
          message(() => headers.forEach()),
          message(() => headers.forEach(1)),
          message(() => { const get = headers.get; return get("a") }),
        ]
      `),
    ).toEqual([
      "Constructor Headers requires 'new'.",
      "new Headers(...) expects a record of names to values, iterable [name, value] pairs, or Headers.",
      "new Headers(...) expects a record of names to values, iterable [name, value] pairs, or Headers.",
      "new Headers(...) expects a record of names to values, iterable [name, value] pairs, or Headers.",
      "new Headers(...) expects a record of names to values, iterable [name, value] pairs, or Headers.",
      "new Headers(...) expects a record of names to values, iterable [name, value] pairs, or Headers.",
      "new Headers(...) expects iterable [name, value] pairs.",
      "new Headers(...) expects iterable [name, value] pairs.",
      expect.stringContaining("bad name"),
      expect.stringContaining("invalid value"),
      expect.stringContaining("Invalid header name"),
      expect.stringContaining("[object Object]"),
      expect.stringContaining("invalid value"),
      "Headers.append requires 2 arguments.",
      "Headers.forEach requires 1 argument.",
      "Headers.forEach expects a function callback.",
      "Headers.prototype.get called on incompatible receiver undefined.",
    ])
  })
})

describe("Map", () => {
  test("get/set/has/size with chaining", async () => {
    expect(
      await value(`
      const m = new Map()
      m.set("a", 1).set("b", 2)
      return { a: m.get("a"), b: m.get("b"), has: m.has("a"), miss: m.get("zz") === undefined, size: m.size }
    `),
    ).toEqual({ a: 1, b: 2, has: true, miss: true, size: 5 - 3 })
  })

  test("object keys use identity", async () => {
    expect(
      await value(`
      const key = { id: 1 }
      const m = new Map()
      m.set(key, "hit")
      return [m.get(key), m.get({ id: 1 }) === undefined]
    `),
    ).toEqual(["hit", true])
  })

  test("construction from entry pairs and another Map", async () => {
    expect(await value(`const m = new Map([["a", 1], ["b", 2]]); return m.get("b")`)).toBe(2)
    expect(
      await value(
        `const m = new Map([["a", 1]]); const n = new Map(m); n.set("b", 2); return [n.get("a"), n.get("b"), m.has("b")]`,
      ),
    ).toEqual([1, 2, false])
    expect((await error(`return new Map("nope")`)).message).toMatch(/\[key, value\] pairs/)
    expect((await error(`return new Map(["flat"])`)).message).toMatch(/\[key, value\] pairs/)
  })

  test("keys/values/entries return live iterators", async () => {
    expect(
      await value(`
      const m = new Map([["a", 1], ["b", 2]])
      const keys = m.keys()
      const first = keys.next()
      m.set("c", 3)
      return { first, rest: [...keys], values: [...m.values()], entries: [...m.entries()], same: [...m[Symbol.iterator]()] }
    `),
    ).toEqual({
      first: { value: "a", done: false },
      rest: ["b", "c"],
      values: [1, 2, 3],
      entries: [
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ],
      same: [
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ],
    })
  })

  test("Object.fromEntries(map) and Array.from(map)", async () => {
    expect(await value(`return Object.fromEntries(new Map([["a", 1], ["b", 2]]))`)).toEqual({ a: 1, b: 2 })
    expect(await value(`return Array.from(new Map([["a", 1]]))`)).toEqual([["a", 1]])
  })

  test("for...of iterates [key, value] pairs with destructuring", async () => {
    expect(
      await value(`
      const m = new Map([["a", 1], ["b", 2]])
      let total = 0
      let names = ""
      for (const [key, count] of m) { names += key; total += count }
      return names + total
    `),
    ).toBe("ab3")
  })

  test("spread produces entry pairs", async () => {
    expect(await value(`return [...new Map([["a", 1]])]`)).toEqual([["a", 1]])
  })

  test("forEach passes (value, key)", async () => {
    expect(
      await value(`
      const m = new Map([["a", 1], ["b", 2]])
      const seen = []
      m.forEach((count, key) => seen.push(key + count))
      return seen
    `),
    ).toEqual(["a1", "b2"])
  })

  test("delete and clear", async () => {
    expect(
      await value(`
      const m = new Map([["a", 1], ["b", 2]])
      const removed = m.delete("a")
      const missed = m.delete("zz")
      const sizeAfterDelete = m.size
      m.clear()
      return [removed, missed, sizeAfterDelete, m.size]
    `),
    ).toEqual([true, false, 1, 0])
  })

  test("counting idiom: grouped tallies", async () => {
    expect(
      await value(`
      const words = ["a", "b", "a", "c", "a"]
      const counts = new Map()
      for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1)
      return Object.fromEntries(counts)
    `),
    ).toEqual({ a: 3, b: 1, c: 1 })
  })

  test("getOrInsert and getOrInsertComputed insert only when the key is missing", async () => {
    expect(
      await value(`
      const groups = new Map()
      groups.getOrInsert("a", []).push(1)
      groups.getOrInsert("a", []).push(2)
      let calls = 0
      const computed = (key) => { calls++; return key + "!" }
      const first = groups.getOrInsertComputed("b", computed)
      const second = groups.getOrInsertComputed("b", computed)
      const zero = groups.getOrInsertComputed(-0, (key) => 1 / key === Infinity)
      return [[...groups], first, second, calls, zero]
    `),
    ).toEqual([
      [
        ["a", [1, 2]],
        ["b", "b!"],
        [0, true],
      ],
      "b!",
      "b!",
      1,
      true,
    ])
    expect(
      await value(`
      const m = new Map()
      const outer = m.getOrInsertComputed("k", () => { m.set("k", "inner"); return "outer" })
      let thrown
      try { m.getOrInsertComputed("j", () => { throw new Error("boom") }) } catch (error) { thrown = error.message }
      return [outer, m.get("k"), thrown, m.has("j")]
    `),
    ).toEqual(["outer", "outer", "boom", false])
    expect((await error(`new Map().getOrInsertComputed("k", 5)`)).message).toContain("expects a function callback")
  })

  test("maps serialize to {} at the boundary, like JSON", async () => {
    expect(await value(`return new Map([["a", 1]])`)).toEqual({})
    expect(await value(`return JSON.stringify(new Map([["a", 1]]))`)).toBe("{}")
  })

  test("console.log renders map contents for debugging", async () => {
    const result = await run(`console.log(new Map([["a", 1]])); return null`)
    expect(result.ok).toBe(true)
    expect(result.logs?.[0]).toBe(`Map(1) [["a",1]]`)
  })
})

describe("Set", () => {
  test("forEach is live on Map and Set: deleted entries are skipped and added ones visited", async () => {
    expect(
      await value(`
        const m = new Map([[1, "a"], [2, "b"]])
        const s = new Set([1, 2])
        const seen = []
        m.forEach((v, k) => { seen.push(k); if (k === 1) { m.delete(2); m.set(3, "c") } })
        s.forEach((v) => { seen.push(v); if (v === 1) { s.delete(2); s.add(3) } })
        return seen
      `),
    ).toEqual([1, 3, 1, 3])
  })

  test("add/has/delete/size with chaining", async () => {
    expect(
      await value(`
      const s = new Set()
      s.add(1).add(2).add(1)
      const removed = s.delete(2)
      return [s.size, s.has(1), s.has(2), removed]
    `),
    ).toEqual([1, true, false, true])
  })

  test("dedupe idiom: [...new Set(items)]", async () => {
    expect(await value(`return [...new Set([1, 2, 2, 3, 1])]`)).toEqual([1, 2, 3])
  })

  test("construction from strings and other Sets", async () => {
    expect(await value(`return [...new Set("aba")]`)).toEqual(["a", "b"])
    expect(await value(`return Array.from(new Set(new Set([1, 2])))`)).toEqual([1, 2])
  })

  test("SameValueZero: NaN is findable", async () => {
    expect(await value(`const s = new Set([NaN]); return s.has(NaN)`)).toBe(true)
  })

  test("for...of iterates values", async () => {
    expect(
      await value(`
      let total = 0
      for (const n of new Set([1, 2, 3])) total += n
      return total
    `),
    ).toBe(6)
  })

  test("sets cross the boundary as arrays; JSON.stringify keeps {} like JS", async () => {
    expect(await value(`return { s: new Set([1, "a", { n: 1 }, undefined]) }`)).toEqual({ s: [1, "a", { n: 1 }, null] })
    expect(await value(`return JSON.stringify(new Set([1]))`)).toBe("{}")
  })
})

describe("Uint8Array", () => {
  test("constructs from a length, an array, an iterable, or another Uint8Array", async () => {
    expect(
      await value(`
      const a = new Uint8Array(2)
      const b = new Uint8Array([1, 2, 300])
      const c = Uint8Array.from(new Set([7, 8]))
      const d = new Uint8Array(b)
      d[0] = 9
      return [[...a], [...b], [...c], [...d], [...b], new Uint8Array("3").length, [...Uint8Array.of(1, "2")]]
    `),
    ).toEqual([[0, 0], [1, 2, 44], [7, 8], [9, 2, 44], [1, 2, 44], 3, [1, 2]])
    expect((await error(`new Uint8Array(-1)`)).message).toContain("Invalid typed array length: -1")
    expect((await error(`new Uint8Array(1.5)`)).message).toContain("Invalid typed array length")
    expect((await error(`new Uint8Array(20_000_000)`)).message).toContain("Invalid array length")
    expect((await error(`Uint8Array.from(/x/)`)).message).toContain("received a RegExp")
  })

  test("index reads and writes clamp to a byte and ignore out-of-range writes, like JS", async () => {
    expect(
      await value(`
      const b = new Uint8Array(3)
      b[0] = 300
      b[1] = -1
      b["2"] = "7"
      b[5] = 9
      b.tag = "x"
      return [b[0], b[1], b[2], b[5], b.length, Object.keys(b), 1 in b, 5 in b, b.tag]
    `),
    ).toEqual([44, 255, 7, null, 3, ["0", "1", "2", "tag"], true, false, "x"])
    expect((await error(`delete new Uint8Array(1)[0]`)).message).toContain("Cannot delete property '0'")
    expect((await error(`Uint8Array.prototype.length`)).message).toContain("incompatible receiver")
  })

  test("iteration, spread, destructuring, and Array.from", async () => {
    expect(
      await value(`
      const b = new Uint8Array([1, 2, 3])
      const [x, ...rest] = b
      const seen = []
      for (const byte of b) seen.push(byte)
      function* g() { yield* b }
      return [x, rest, seen, [...g()], Array.from(b, (n) => n * 2), new Set(b).size, Array.isArray(b)]
    `),
    ).toEqual([1, [2, 3], [1, 2, 3], [1, 2, 3], [2, 4, 6], 3, false])
  })

  test("methods", async () => {
    expect(
      await value(`
      const b = Uint8Array.from([1, 2, 3, 2])
      const view = b.subarray(1, 3)
      view.fill(9)
      const copy = b.slice(0, 2)
      copy[0] = 5
      const target = new Uint8Array(4)
      target.set([1, 2], 2)
      target.set(b.subarray(0, 1))
      return [
        b.at(-1), [...b], [...copy], [...target], b.indexOf(9), b.lastIndexOf(9), b.includes(3), b.includes(2, 1),
        b.join("-"), b.toString(), [...b.keys()], [...b.values()], [...b.entries()], [...Uint8Array.from([1, 2]).reverse()],
      ]
    `),
    ).toEqual([
      2,
      [1, 9, 9, 2],
      [5, 9],
      [1, 0, 1, 2],
      1,
      2,
      false,
      true,
      "1-9-9-2",
      "1,9,9,2",
      [0, 1, 2, 3],
      [1, 9, 9, 2],
      [
        [0, 1],
        [1, 9],
        [2, 9],
        [3, 2],
      ],
      [2, 1],
    ])
    expect((await error(`new Uint8Array(2).set([1, 2, 3])`)).message).toContain("does not fit")
    expect((await error(`new Uint8Array(2).set([1], 2)`)).message).toContain("does not fit")
  })

  test("base64 and hex", async () => {
    expect(
      await value(`
      return [
        new Uint8Array([104, 105]).toBase64(), new Uint8Array([255, 0]).toHex(),
        [...Uint8Array.fromBase64("aGk=")], [...Uint8Array.fromHex("ff00")],
      ]
    `),
    ).toEqual(["aGk=", "ff00", [104, 105], [255, 0]])
    expect(await error(`Uint8Array.fromBase64("!!!")`)).toMatchObject({
      message: expect.stringContaining("SyntaxError"),
    })
    expect(await error(`Uint8Array.fromHex("zz")`)).toMatchObject({ message: expect.stringContaining("SyntaxError") })
  })

  test("coercion, console, JSON, and Object.prototype.toString", async () => {
    expect(
      await value(`
      const b = new Uint8Array([1, 2])
      console.log(b, new Uint8Array())
      return [String(b), b + "", +new Uint8Array([5]), Number.isNaN(Number(b)), b == "1,2", JSON.stringify(b), b.toLocaleString(), typeof b, b instanceof Uint8Array]
    `),
    ).toEqual(["1,2", "1,2", 5, true, true, '{"0":1,"1":2}', "1,2", "object", true])
    expect((await run(`console.log(new Uint8Array([1, 2]), new Uint8Array())`)).logs).toEqual([
      "Uint8Array(2) [1,2] Uint8Array(0) []",
    ])
  })

  test("cannot cross the tool boundary; the error says how to encode it", async () => {
    expect((await error(`return new Uint8Array(1)`)).message).toContain("pass text instead")
    expect((await error(`return { deep: [new Uint8Array(1)] }`)).message).toContain("bytes.toBase64()")
    expect(await value(`return new Uint8Array([7, 8]).toBase64()`)).toBe("Bwg=")
  })
})

describe("TextEncoder and TextDecoder", () => {
  test("round-trips UTF-8 and exposes the standard fields", async () => {
    expect(
      await value(`
      const encoder = new TextEncoder()
      const bytes = encoder.encode("héllo ✓")
      const decoder = new TextDecoder()
      return [
        [...bytes], decoder.decode(bytes), decoder.decode(), [...encoder.encode()], encoder.encoding,
        decoder.encoding, decoder.fatal, decoder.ignoreBOM, new TextDecoder("UTF8", { fatal: true }).fatal,
        new TextDecoder().decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])),
        new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])),
        new TextDecoder().decode(new Uint8Array([0xff])),
        encoder instanceof TextEncoder, decoder instanceof TextDecoder,
      ]
    `),
    ).toEqual([
      [104, 195, 169, 108, 108, 111, 32, 226, 156, 147],
      "héllo ✓",
      "",
      [],
      "utf-8",
      "utf-8",
      false,
      false,
      true,
      "A",
      "\ufeffA",
      "\ufffd",
      true,
      true,
    ])
  })

  test("only UTF-8 is supported; fatal decoding rejects malformed input", async () => {
    expect((await error(`new TextDecoder("latin1")`)).message).toContain('The "latin1" encoding is not supported')
    expect((await error(`new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xff]))`)).message).toContain(
      "not valid utf-8",
    )
    expect((await error(`new TextDecoder().decode("text")`)).message).toContain(
      "expects a Uint8Array, received a string",
    )
    expect((await error(`TextDecoder()`)).message).toContain("requires 'new'")
  })

  test("crypto.getRandomValues fills the given bytes in place", async () => {
    expect(
      await value(
        `const b = new Uint8Array(16); const same = crypto.getRandomValues(b) === b; return [same, b.length, b.some ? 0 : Array.from(b).some((n) => n !== 0)]`,
      ),
    ).toEqual([true, 16, true])
    expect((await error(`crypto.getRandomValues([1])`)).message).toContain("expects a Uint8Array, received an array")
  })
})

describe("Iterator helpers", () => {
  test("lazy helpers chain over collection iterators and generators, one source step per result", async () => {
    expect(
      await value(`
        const pulled = []
        function* naturals() { let n = 0; while (true) { pulled.push(n); yield n++ } }
        const squares = naturals().map((n) => n * n).filter((n) => n % 2 === 0).drop(1).take(3)
        const first = squares.next()
        return {
          first,
          rest: squares.toArray(),
          after: squares.next(),
          pulled,
          values: new Map([["a", 1], ["b", 2]]).values().map((v, i) => v * 10 + i).toArray(),
          flat: [1, 2].values().flatMap((n) => [n, [n]]).toArray(),
          entries: [...new Map([[1, 2]]).entries().map(([k, v]) => k + v)],
        }
      `),
    ).toEqual({
      first: { value: 4, done: false },
      rest: [16, 36],
      after: { done: true },
      pulled: [0, 1, 2, 3, 4, 5, 6],
      values: [10, 21],
      flat: [1, [1], 2, [2]],
      entries: [3],
    })
  })

  test("eager helpers consume the source and close it on early exit", async () => {
    expect(
      await value(`
        const log = []
        function* g() { try { yield 1; yield 2; yield 3 } finally { log.push("closed") } }
        const seen = []
        g().forEach((v, i) => seen.push([v, i]))
        return {
          seen,
          sum: g().reduce((a, b) => a + b),
          sumFrom: g().reduce((a, b) => a + b, 10),
          some: g().some((v) => v === 2),
          every: g().every((v) => v < 2),
          find: g().find((v) => v > 1),
          missing: g().find((v) => v > 5),
          log,
        }
      `),
    ).toEqual({
      seen: [
        [1, 0],
        [2, 1],
        [3, 2],
      ],
      sum: 6,
      sumFrom: 16,
      some: true,
      every: false,
      find: 2,
      log: ["closed", "closed", "closed", "closed", "closed", "closed", "closed"],
    })
  })

  test("a helper closes its source when a callback throws, on return(), and on early for...of exit", async () => {
    expect(
      await value(`
        const log = []
        function* g(name) { try { yield 1; yield 2 } finally { log.push(name) } }
        const throwing = g("throw").map((v) => { if (v === 2) throw new Error("boom"); return v })
        throwing.next()
        let message
        try { throwing.next() } catch (error) { message = error.message }
        const returned = g("return").map((v) => v)
        returned.next()
        const closed = returned.return()
        for (const v of g("loop").filter((v) => true)) break
        return { message, afterThrow: throwing.next(), closed, afterReturn: returned.next(), log }
      `),
    ).toEqual({
      message: "boom",
      afterThrow: { done: true },
      closed: { done: true },
      afterReturn: { done: true },
      log: ["throw", "return", "loop"],
    })
  })

  test("collection iterators have no return() and continue after an early exit, as in JS", async () => {
    expect(
      await value(`
        const it = [1, 2, 3].values()
        const found = it.some((v) => v === 2)
        return [typeof it.return, found, it.next().value, typeof it.map(x => x).return]
      `),
    ).toEqual(["undefined", true, 3, "function"])
  })

  test("Iterator.from and the abstract Iterator constructor", async () => {
    expect(
      await value(`
        const it = [1].values()
        let n = 0
        const errors = []
        for (const attempt of [() => Iterator(), () => new Iterator(), () => Iterator.from(5)]) {
          try { attempt() } catch (error) { errors.push(error.name) }
        }
        return [
          Iterator.from(it) === it,
          Iterator.from("ab").toArray(),
          Iterator.from([1, 2]).map((v) => v * 2).toArray(),
          Iterator.from({ next: () => ({ done: n > 1, value: n++ }) }).toArray(),
          it instanceof Iterator,
          errors,
        ]
      `),
    ).toEqual([true, ["a", "b"], [2, 4], [0, 1], true, ["TypeError", "TypeError", "TypeError"]])
  })

  test("argument validation", async () => {
    const cases: Array<[string, string]> = [
      ["[1].values().map(1)", "Iterator.prototype.map expects a function callback."],
      ["[1].values().take(-1)", "Iterator.prototype.take expects a non-negative count, received -1."],
      ["[1].values().drop()", "Iterator.prototype.drop expects a non-negative count, received NaN."],
      [
        "[1].values().flatMap((v) => 'ab').toArray()",
        "Iterator.prototype.flatMap expects an iterable or iterator, received a string.",
      ],
      ["[].values().reduce((a, b) => a)", "Iterator.prototype.reduce of an empty iterator with no initial value."],
    ]
    for (const [code, message] of cases) {
      expect((await error(`return ${code}`)).message).toContain(message)
    }
    expect(
      await error(`
        function* g() { while (true) yield 1 }
        const it = g().map(() => it.next())
        return it.next()
      `),
    ).toMatchObject({ message: expect.stringContaining("Iterator helper is already running.") })
  })
})

describe("built-in iterators", () => {
  test("keys/values/entries and [Symbol.iterator] step with next() and stay live", async () => {
    expect(
      await value(`
        const items = ["a"]
        const it = items.entries()
        items.push("b")
        const steps = [it.next(), it.next(), it.next()]
        items.push("c")
        return { steps, after: it.next(), same: items[Symbol.iterator] === items.values }
      `),
    ).toEqual({
      steps: [{ value: [0, "a"], done: false }, { value: [1, "b"], done: false }, { done: true }],
      after: { done: true },
      same: true,
    })
    expect(
      await value(`
        const s = new Set([1, 2])
        const u = new URLSearchParams("a=1&b=2")
        const h = new Headers({ b: "2", a: "1" })
        const bytes = new Uint8Array([7, 8])
        return [
          [...s.entries()], [...s[Symbol.iterator]()], s[Symbol.iterator] === s.values,
          [...u.keys()], [...u[Symbol.iterator]()], u[Symbol.iterator] === u.entries,
          [...h.values()], [...h[Symbol.iterator]()], h[Symbol.iterator] === h.entries,
          [...bytes.entries()], [...bytes[Symbol.iterator]()], bytes[Symbol.iterator] === bytes.values,
          [..."ab"[Symbol.iterator]()],
        ]
      `),
    ).toEqual([
      [
        [1, 1],
        [2, 2],
      ],
      [1, 2],
      true,
      ["a", "b"],
      [
        ["a", "1"],
        ["b", "2"],
      ],
      true,
      ["1", "2"],
      [
        ["a", "1"],
        ["b", "2"],
      ],
      true,
      [
        [0, 7],
        [1, 8],
      ],
      [7, 8],
      true,
      ["a", "b"],
    ])
  })

  test("iterators are consumed once by every iteration site", async () => {
    expect(
      await value(`
        const it = [1, 2, 3, 4].values()
        const picked = []
        for (const item of it) { picked.push(item); if (item === 2) break }
        const [third] = it
        return { picked, third, rest: [...it], spent: Array.from(it), again: it[Symbol.iterator]() === it }
      `),
    ).toEqual({ picked: [1, 2], third: 3, rest: [4], spent: [], again: true })
    expect(
      await value(`
        const m = new Map([["a", 1], ["b", 2]])
        return [
          Object.fromEntries(m.entries()), Array.from(m.keys(), (k) => k + "!"), new Set(m.values()).size,
          await Promise.all([Promise.resolve(1), 2].values()),
        ]
      `),
    ).toEqual([{ a: 1, b: 2 }, ["a!", "b!"], 2, [1, 2]])
    expect(await value(`let s = 0; for await (const v of [Promise.resolve(1), 2].values()) s += v; return s`)).toBe(3)
    expect(
      await value(`return new Set([1, 2]).union({ size: 1, has: () => false, keys: () => new Set([3]).keys() })`),
    ).toEqual([1, 2, 3])
  })

  test("iterators are opaque references", async () => {
    expect(await value(`return [1].keys()`)).toEqual({})
    expect(await value(`return JSON.stringify({ it: [1].keys() })`)).toBe('{"it":{}}')
    expect(await value(`return [typeof [1].keys(), Array.isArray([1].keys()), Object.keys([1].keys())]`)).toEqual([
      "object",
      false,
      [],
    ])
    const logged = await run(`console.log([1].keys()); return null`)
    expect(logged.logs?.[0]).toBe("[opaque reference]")
    expect((await error(`return [1].keys() + ""`)).message).toContain("Binary operators require data values")
    expect((await error(`return [1].keys().next.call({})`)).message).toContain("is not a function")
    expect((await error(`const it = [1].keys(); const next = it.next; return next()`)).message).toContain(
      "Iterator.prototype.next called on incompatible receiver undefined",
    )
  })
})

describe("Object.prototype.toString", () => {
  test("reports the built-in kind it is inherited by, as JS does through Symbol.toStringTag", async () => {
    expect(
      await value(`
      return [
        new Map().toString(), new Set().toString(), new Headers().toString(), Promise.resolve(1).toString(),
        [1].values().toString(), ({}).toString(), String(new Map()), String(Promise.resolve(1)),
        \`\${new Set([1])}\`, [new Map()] + "", new Map() == "[object Map]",
      ]
    `),
    ).toEqual([
      "[object Map]",
      "[object Set]",
      "[object Headers]",
      "[object Promise]",
      "[object Iterator]",
      "[object Object]",
      "[object Map]",
      "[object Promise]",
      "[object Set]",
      "[object Map]",
      true,
    ])
  })
})

describe("console.log of errors", () => {
  test("prints name and message, nested too", async () => {
    const result = await run(`console.log(new Error("boom"), { e: new RangeError("r") })`)
    expect(result.logs).toEqual(['Error: boom {"e":RangeError: r}'])
  })
})

describe("toLocaleString", () => {
  test("numbers and dates format as en-US in UTC; everything else falls back to toString", async () => {
    expect(
      await value(`
      return [
        (1234567.891).toLocaleString(), new Date(0).toLocaleString(), new Date(0).toLocaleDateString(),
        new Date(0).toLocaleTimeString(), "a".toLocaleString(), true.toLocaleString(), ({}).toLocaleString(),
        ({ toString: () => "custom" }).toLocaleString(), new Uint8Array([1, 2]).toLocaleString(),
      ]
    `),
    ).toEqual([
      "1,234,567.891",
      "1/1/1970, 12:00:00 AM",
      "1/1/1970",
      "12:00:00 AM",
      "a",
      "true",
      "[object Object]",
      "custom",
      "1,2",
    ])
  })

  test("arrays join each element's toLocaleString, skipping holes and nullish elements", async () => {
    expect(
      await value(`
      let calls = 0
      const item = { toLocaleString() { calls++; return "o" } }
      return [[1234.5, "x", null, undefined, item, new Date(0)].toLocaleString(), [, item, , item].toLocaleString(), calls]
    `),
    ).toEqual(["1,234.5,x,,,o,1/1/1970, 12:00:00 AM", ",o,,o", 3])
    expect((await error(`const f = ({}).toLocaleString; f()`)).message).toContain(
      "Object.prototype.toLocaleString called on null or undefined",
    )
  })

  test("toLocaleLowerCase and toLocaleUpperCase ignore the locale argument", async () => {
    expect(
      await value(`return ["ABC".toLocaleLowerCase("tr"), "abc".toLocaleUpperCase(), "İ".toLocaleLowerCase()]`),
    ).toEqual(["abc", "ABC", "i̇"])
  })
})

describe("stdlib integration", () => {
  test("constructor follows own keys, shadowing, writes, and new", async () => {
    expect(
      await value(`return [JSON.parse('{"constructor":"Foo"}').constructor, ({ constructor: 1 }).constructor]`),
    ).toEqual(["Foo", 1])
    expect(await value(`const Array = 5; return [].constructor.isArray([])`)).toBe(true)
    expect(await value(`const o = {}; o.constructor = 7; return o.constructor`)).toBe(7)
    expect(await value(`return new ([].constructor)(3).length`)).toBe(3)
    expect(await value(`return typeof ({}).constructor`)).toBe("function")
    expect(await value(`return ({}).constructor.constructor === Function`)).toBe(true)
  })

  test("new dispatches on the constructor value, not its name", async () => {
    expect(await value(`const D = Date; return new D(0) instanceof Date`)).toBe(true)
    expect(await value(`const make = (C) => new C([["a", 1]]); return make(Map).get("a")`)).toBe(1)
    expect(await value(`const t = { M: Map }; return new t.M() instanceof Map`)).toBe(true)
    const shadowed = await error(`const Date = 5; return new Date()`)
    expect(shadowed.message).toStartWith("TypeError: Date is not a constructor.")
    const fn = await error(`const f = () => 1; return new f()`)
    expect(fn.message).toStartWith("TypeError: f cannot be constructed")
  })

  test("Object.is uses SameValue semantics", async () => {
    expect(
      await value(`
        const object = {}
        return [
          Object.is(NaN, NaN),
          Object.is(0, -0),
          Object.is(object, object),
          Object.is({}, {}),
        ]
      `),
    ).toEqual([true, false, true, false])
  })

  test("Object.is rejects opaque runtime references", async () => {
    expect((await error(`return Object.is(Math.max, Math.max)`)).kind).toBe("InvalidDataValue")
  })

  test("Object values and entries accept arrays", async () => {
    expect(await value(`return [Object.values(["a", "b"]), Object.entries(["a", "b"])]`)).toEqual([
      ["a", "b"],
      [
        ["0", "a"],
        ["1", "b"],
      ],
    ])
    expect(await value(`const match = /a/.exec("ba"); return [Object.values(match), Object.entries(match)]`)).toEqual([
      ["a", 1, "ba"],
      [
        ["0", "a"],
        ["index", 1],
        ["input", "ba"],
      ],
    ])
    expect(await value(`return Object.keys(Object.values({ match: /a/.exec("ba") })[0])`)).toEqual([
      "0",
      "index",
      "input",
    ])
  })

  test("Object.fromEntries accepts every supported entry collection", async () => {
    expect(
      await value(`
        return [
          Object.fromEntries([["a", 1]]),
          Object.fromEntries(new Map([["b", 2]])),
          Object.fromEntries(new Set([["c", 3]])),
          Object.fromEntries(new URLSearchParams("d=4")),
          Object.fromEntries([{ 0: "e", 1: 5 }]),
          Object.fromEntries(new Set([[{}, 6], [new Date(0), 7], [null, 8], [undefined, 9]])),
        ]
      `),
    ).toEqual([
      { a: 1 },
      { b: 2 },
      { c: 3 },
      { d: "4" },
      { e: 5 },
      { "[object Object]": 6, "1970-01-01T00:00:00.000Z": 7, null: 8, undefined: 9 },
    ])
    expect(await value(`try { Object.fromEntries(new Set([Math.max])); return false } catch { return true }`)).toBe(
      true,
    )
    expect(
      await value(`try { Object.fromEntries(new Map([["fn", Math.max]])); return false } catch { return true }`),
    ).toBe(true)
  })

  test("deterministic Math methods match the host runtime", async () => {
    const result = await value(`
      return [
        Math.acos(0.5), Math.acosh(2), Math.asin(0.5), Math.asinh(2), Math.atan(1), Math.atan2(1, 2), Math.atanh(0.5),
        Math.cos(0.5), Math.cosh(0.5), Math.sin(0.5), Math.sinh(0.5), Math.tan(0.5), Math.tanh(0.5),
        Math.log1p(0.5), Math.expm1(0.5), Math.f16round(1.337), Math.fround(1.337), Math.clz32(1), Math.imul(2, 3),
      ]
    `)
    expect(result).toEqual([
      Math.acos(0.5),
      Math.acosh(2),
      Math.asin(0.5),
      Math.asinh(2),
      Math.atan(1),
      Math.atan2(1, 2),
      Math.atanh(0.5),
      Math.cos(0.5),
      Math.cosh(0.5),
      Math.sin(0.5),
      Math.sinh(0.5),
      Math.tan(0.5),
      Math.tanh(0.5),
      Math.log1p(0.5),
      Math.expm1(0.5),
      Math.f16round(1.337),
      Math.fround(1.337),
      Math.clz32(1),
      Math.imul(2, 3),
    ])
  })

  test("Object.assign mutates and returns its target", async () => {
    expect(
      await value(`
        const target = { a: 1 }
        const result = Object.assign(target, { b: 2 })
        return { target, result, same: target === result }
      `),
    ).toEqual({ target: { a: 1, b: 2 }, result: { a: 1, b: 2 }, same: true })
    expect(await value(`try { Object.assign(null, { a: 1 }); return false } catch { return true }`)).toBe(true)
  })

  test("Object.assign rejects direct and nested cycles", async () => {
    expect(
      await value(`
        const target = { kept: true }
        try { Object.assign(target, { self: target }) } catch { return target }
        return null
      `),
    ).toEqual({ kept: true })
    expect(
      await value(`
        const target = { kept: true }
        const nested = { target }
        try { Object.assign(target, { nested }) } catch { return target }
        return null
      `),
    ).toEqual({ kept: true })
    expect(
      await value(`
        const target = {}
        const source = {}
        source[Symbol.iterator] = target
        try { Object.assign(target, source) } catch { return Object.hasOwn(target, Symbol.iterator) }
        return true
      `),
    ).toBe(false)
    expect(
      await value(`
        const target = {}
        const nested = {}
        nested[Symbol.iterator] = target
        try { Object.assign(target, { nested }) } catch { return Object.hasOwn(target, "nested") }
        return true
      `),
    ).toBe(false)
  })

  test("Object.assign preserves mutations before a circular field", async () => {
    expect(
      await value(`
        const target = {}
        try { Object.assign(target, { before: 1, cycle: { target }, after: 2 }) } catch { return target }
        return null
      `),
    ).toEqual({ before: 1 })
    expect(
      await value(`
        const target = {}
        const marker = {}
        const source = {}
        source[Symbol.iterator] = marker
        source[Symbol.asyncIterator] = target
        try { Object.assign(target, source) } catch {
          return [target[Symbol.iterator] === marker, Object.hasOwn(target, Symbol.asyncIterator)]
        }
        return null
      `),
    ).toEqual([true, false])
  })

  test("Object.assign preserves target identity and acyclic shared aliases", async () => {
    expect(
      await value(`
        const shared = { count: 1 }
        const target = {}
        const result = Object.assign(target, { left: shared, right: shared })
        result.left.count = 2
        return [result === target, result.left === shared, result.left === result.right, shared.count]
      `),
    ).toEqual([true, true, true, 2])
  })

  test("assignment resolves and reads its left side before evaluating the right side", async () => {
    expect(await value(`let x = 1; x += (x = 5); return x`)).toBe(6)
    expect(await value(`let i = 0; const values = [9]; values[i++] = i; return [values, i]`)).toEqual([[1], 1])
    expect(await value(`let i = 0; const values = [10, 20]; values[i++] += i; return [values, i]`)).toEqual([
      [11, 20],
      1,
    ])
  })

  test("typeof reports constructors as functions and never throws", async () => {
    expect(await value(`return typeof Map`)).toBe("function")
    expect(await value(`return typeof ((x) => x)`)).toBe("function")
    expect(await value(`return typeof Math`)).toBe("object")
    expect(await value(`return typeof tools`)).toBe("object")
  })

  test("negation works on any value", async () => {
    expect(await value(`return !new Map()`)).toBe(false)
    expect(await value(`const fn = () => 1; return !fn`)).toBe(false)
  })

  test("object spread of CodeMode values is a no-op, like JS", async () => {
    expect(await value(`return { ...new Map([["a", 1]]), kept: true }`)).toEqual({ kept: true })
  })

  test("dates inside Map values survive in-CodeMode reads", async () => {
    expect(
      await value(`
      const m = new Map([["start", new Date(1000)]])
      return m.get("start").getTime()
    `),
    ).toBe(1000)
  })

  test("instanceof recognizes the stdlib value types", async () => {
    expect(
      await value(
        `return [new Date(0) instanceof Date, /a/ instanceof RegExp, new Map() instanceof Map, new Set() instanceof Set]`,
      ),
    ).toEqual([true, true, true, true])
    expect(
      await value(`return [[1] instanceof Array, [1] instanceof Object, ({}) instanceof Object, 5 instanceof Object]`),
    ).toEqual([true, true, true, false])
    expect(await value(`return [new Map() instanceof Set, "s" instanceof Date]`)).toEqual([false, false])
    expect(
      await value(`const p = Promise.resolve(1); const isPromise = p instanceof Promise; await p; return isPromise`),
    ).toBe(true)
  })

  test("realistic pipeline: parse, extract with regex, dedupe, count by day", async () => {
    expect(
      await value(`
      const raw = '[{"at":"2024-01-01T05:00:00Z","tag":"a b"},{"at":"2024-01-01T09:00:00Z","tag":"b c"},{"at":"2024-01-02T01:00:00Z","tag":"a"}]'
      const rows = JSON.parse(raw)
      const tags = new Set()
      const byDay = new Map()
      for (const row of rows) {
        for (const m of row.tag.matchAll(/[a-z]+/g)) tags.add(m[0])
        const day = new Date(row.at).toISOString().slice(0, 10)
        byDay.set(day, (byDay.get(day) ?? 0) + 1)
      }
      return { tags: [...tags].sort((a, b) => (a < b ? -1 : 1)), byDay: Object.fromEntries(byDay) }
    `),
    ).toEqual({ tags: ["a", "b", "c"], byDay: { "2024-01-01": 2, "2024-01-02": 1 } })
  })
})

describe("CodeMode values at intra-CodeMode checkpoints", () => {
  test("Object.values/entries keep Dates usable", async () => {
    expect(await value(`return Object.values({ d: new Date(0) })[0].getTime()`)).toBe(0)
    expect(await value(`const [key, d] = Object.entries({ d: new Date(0) })[0]; return key + ":" + d.getTime()`)).toBe(
      "d:0",
    )
  })

  test("Object.values/entries preserve nested object identity", async () => {
    expect(
      await value(`
      const child = { selected: false }
      const rows = { a: child }
      Object.values(rows)[0].selected = true
      return child.selected
    `),
    ).toBe(true)
    expect(
      await value(`
      const child = { selected: false }
      const rows = { a: child }
      Object.entries(rows)[0][1].selected = true
      return child.selected
    `),
    ).toBe(true)
  })

  test("Object enumeration preserves promises and callable references", async () => {
    expect(
      await value(`
      const pending = Promise.resolve(1)
      const source = { pending }
      return [Object.keys(source), Object.hasOwn(source, "pending"), await Object.values(source)[0], await Object.entries(source)[0][1]]
    `),
    ).toEqual([["pending"], true, 1, 1])
    expect(await value(`return Object.values({ max: Math.max })[0](1, 2)`)).toBe(2)
  })

  test("Object enumeration rejects invalid receivers and gives promises an await hint", async () => {
    const diagnostic = await error(`return Object.keys(Promise.resolve({ a: 1 }))`)
    expect(diagnostic.kind).toBe("InvalidDataValue")
    expect(diagnostic.message).toContain("await")
    expect(await value(`return Object.keys(Math)`)).toEqual([])
  })

  test("Object.assign keeps Maps usable", async () => {
    expect(await value(`const merged = Object.assign({}, { m: new Map([["a", 1]]) }); return merged.m.get("a")`)).toBe(
      1,
    )
  })

  test("object and array spread keep CodeMode values usable", async () => {
    expect(
      await value(`
      const src = { m: new Map([["a", 1]]) }
      const copy = { ...src }
      copy.m.set("b", 2)
      return [copy.m.get("a"), src.m.get("b")]
    `),
    ).toEqual([1, 2])
    expect(await value(`const list = [new Date(1000)]; const copy = [...list]; return copy[0].getTime()`)).toBe(1000)
  })

  test("Array.from over arrays keeps nested CodeMode values usable", async () => {
    expect(await value(`return Array.from([new Date(5)])[0].getTime()`)).toBe(5)
  })

  test("Array.from and Array.of preserve nested object identity", async () => {
    expect(
      await value(`
      const child = { selected: false }
      Array.from([child])[0].selected = true
      return child.selected
    `),
    ).toBe(true)
    expect(
      await value(`
      const child = { selected: false }
      Array.of(child)[0].selected = true
      return child.selected
    `),
    ).toBe(true)
  })

  test("Array.from and Array.of preserve promises and callable references", async () => {
    expect(
      await value(`
      const pending = Promise.resolve(1)
      return [await Array.from([pending])[0], await Array.of(pending)[0]]
    `),
    ).toEqual([1, 1])
    expect(await value(`return [Array.from([Math.max])[0](1, 2), Array.of(Math.max)[0](3, 4)]`)).toEqual([2, 4])
  })

  test("Array.from preserves identity across supported collection shapes", async () => {
    expect(
      await value(`
      const child = { selected: false }
      const fromArrayLike = Array.from({ 0: child, length: 1 })
      const fromMap = Array.from(new Map([["child", child]]))
      const fromSet = Array.from(new Set([child]))
      fromArrayLike[0].selected = true
      return [fromMap[0][1] === child, fromSet[0] === child, child.selected]
    `),
    ).toEqual([true, true, true])
  })

  test("Array.from rejects invalid receivers and gives promises an await hint", async () => {
    const diagnostic = await error(`return Array.from(Promise.resolve([1]))`)
    expect(diagnostic.kind).toBe("InvalidDataValue")
    expect(diagnostic.message).toContain("await")
    expect(await value(`return Array.from((a, b) => 1)`)).toEqual([null, null])
  })

  test("regexes stay callable through Object.values", async () => {
    expect(await value(`return Object.values({ r: /ab+/ })[0].test("abb")`)).toBe(true)
  })

  test("Object.* helpers see CodeMode values as empty objects, never internals", async () => {
    expect(await value(`return Object.keys(new Map([["a", 1]]))`)).toEqual([])
    expect(await value(`return Object.values(new Date(0))`)).toEqual([])
    expect(await value(`return Object.entries(new Set([1]))`)).toEqual([])
    expect(await value(`return Object.assign({}, new Map([["a", 1]]))`)).toEqual({})
    expect(await value(`return Object.hasOwn(new Date(0), "time")`)).toBe(false)
  })

  test("the host boundary still serializes JSON forms: results, JSON.stringify, and tool arguments", async () => {
    expect(await value(`return { d: new Date(0), m: new Map([["a", 1]]) }`)).toEqual({
      d: "1970-01-01T00:00:00.000Z",
      m: {},
    })
    expect(await value(`return JSON.stringify({ d: new Date(0) })`)).toBe('{"d":"1970-01-01T00:00:00.000Z"}')

    const observed: Array<unknown> = []
    const capture = Tool.make({
      description: "Capture the exact input the host receives",
      input: { type: "object" },
      execute: (input) =>
        Effect.sync(() => {
          observed.push(input)
          return "ok"
        }),
    })
    const result = await Effect.runPromise(
      CodeMode.execute({
        tools: { host: { capture } },
        code: `return await tools.host.capture({ when: new Date(0), tags: new Map([["a", 1]]) })`,
      }),
    )
    expect(result.ok).toBe(true)
    expect(observed).toStrictEqual([{ when: "1970-01-01T00:00:00.000Z", tags: {} }])
  })
})
