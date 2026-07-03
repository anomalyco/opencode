import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode, Tool } from "../src/index.js"

// Standard-library value types: Date, RegExp, Map, Set. Programs use them as ordinary JS;
// intra-sandbox checkpoints (Object.* helpers, spread, coercion inputs) preserve the live
// values, while at the host boundary (final result, tool arguments, JSON.stringify) they
// serialize exactly as JSON.stringify would: Date -> ISO string (invalid -> null),
// RegExp/Map/Set -> {}.
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

  test("invalid dates yield NaN times, guardable in-sandbox", async () => {
    expect(await value(`return Number.isNaN(new Date("garbage").getTime())`)).toBe(true)
    expect(await value(`return new Date("garbage").toJSON()`)).toBeNull()
  })

  test("toISOString on an invalid date is a catchable error", async () => {
    expect(await value(`try { new Date("garbage").toISOString(); return "no" } catch { return "caught" }`)).toBe(
      "caught",
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

  test("string match: non-global carries index, global lists all matches", async () => {
    expect(await value(`const m = "a1b22".match(/\\d+/); return [m[0], m.index]`)).toEqual(["1", 1])
    expect(await value(`return "a1b22".match(/\\d+/g)`)).toEqual(["1", "22"])
    expect(await value(`return "abc".match(/\\d/)`)).toBeNull()
  })

  test("matchAll materializes match arrays with captures", async () => {
    expect(await value(`return "a1b22".matchAll(/(\\d+)/g).map((m) => m[1])`)).toEqual(["1", "22"])
  })

  test("replace and replaceAll with patterns and $1 substitution", async () => {
    expect(await value(`return "a1b2".replace(/\\d/, "#")`)).toBe("a#b2")
    expect(await value(`return "a1b2".replace(/\\d/g, "#")`)).toBe("a#b#")
    expect(await value(`return "a1b2".replaceAll(/\\d/g, "#")`)).toBe("a#b#")
    expect(await value(`return "hi bob".replace(/b(o)b/, "[$1]")`)).toBe("hi [o]")
  })

  test("replaceAll without the g flag is a catchable error", async () => {
    expect(await value(`try { "a".replaceAll(/a/, "b"); return "no" } catch { return "caught" }`)).toBe("caught")
  })

  test("split and search accept patterns", async () => {
    expect(await value(`return "a1b22c".split(/\\d+/)`)).toEqual(["a", "b", "c"])
    expect(await value(`return "ab42".search(/\\d/)`)).toBe(2)
    expect(await value(`return "ab".search(/\\d/)`)).toBe(-1)
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

  test("a non-pattern argument names the expected shapes", async () => {
    const err = await error(`return "abc".match(42)`)
    expect(err.message).toContain("expects a regular expression")
    expect(err.message).toContain("not number")
  })

  test("source and flags properties read through", async () => {
    expect(await value(`const r = /ab/gi; return { source: r.source, flags: r.flags, global: r.global }`)).toEqual({
      source: "ab",
      flags: "gi",
      global: true,
    })
  })

  test("regexes serialize to {} at the boundary, like JSON", async () => {
    expect(await value(`return /a/`)).toEqual({})
    expect(await value(`return JSON.stringify({ r: /a/g })`)).toBe('{"r":{}}')
  })

  test("template interpolation renders the literal form", async () => {
    expect(await value("return `${/ab/g}`")).toBe("/ab/g")
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

  test("keys/values/entries return arrays", async () => {
    expect(
      await value(`
      const m = new Map([["a", 1], ["b", 2]])
      return { keys: m.keys(), values: m.values(), entries: m.entries() }
    `),
    ).toEqual({
      keys: ["a", "b"],
      values: [1, 2],
      entries: [
        ["a", 1],
        ["b", 2],
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

  test("sets serialize to {} at the boundary, like JSON", async () => {
    expect(await value(`return { s: new Set([1]) }`)).toEqual({ s: {} })
  })
})

describe("stdlib integration", () => {
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

  test("object spread of sandbox values is a no-op, like JS", async () => {
    expect(await value(`return { ...new Map([["a", 1]]), kept: true }`)).toEqual({ kept: true })
  })

  test("dates inside Map values survive in-sandbox reads", async () => {
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

describe("sandbox values at intra-sandbox checkpoints", () => {
  test("Object.values/entries keep Dates usable", async () => {
    expect(await value(`return Object.values({ d: new Date(0) })[0].getTime()`)).toBe(0)
    expect(await value(`const [key, d] = Object.entries({ d: new Date(0) })[0]; return key + ":" + d.getTime()`)).toBe(
      "d:0",
    )
  })

  test("Object.assign keeps Maps usable", async () => {
    expect(await value(`const merged = Object.assign({}, { m: new Map([["a", 1]]) }); return merged.m.get("a")`)).toBe(
      1,
    )
  })

  test("object and array spread keep sandbox values usable", async () => {
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

  test("Array.from over arrays keeps nested sandbox values usable", async () => {
    expect(await value(`return Array.from([new Date(5)])[0].getTime()`)).toBe(5)
  })

  test("regexes stay callable through Object.values", async () => {
    expect(await value(`return Object.values({ r: /ab+/ })[0].test("abb")`)).toBe(true)
  })

  test("Object.* helpers see sandbox values as empty objects, never internals", async () => {
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
      run: (input) =>
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
