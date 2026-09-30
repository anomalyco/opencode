import { describe, expect, test } from "bun:test"
import { Codec } from "./codec"

describe("Codec", () => {
  test("primitives reject the wrong shape and finite numbers only", () => {
    expect(Codec.string.decode("a")).toBe("a")
    expect(Codec.string.decode(1)).toBe(Codec.INVALID)
    expect(Codec.number.decode(1.5)).toBe(1.5)
    expect(Codec.number.decode(Number.NaN)).toBe(Codec.INVALID)
    expect(Codec.nonNegativeInt.decode(-1)).toBe(Codec.INVALID)
    expect(Codec.literals(["a", "b"]).decode("c")).toBe(Codec.INVALID)
    expect(Codec.literal("x").decode("x")).toBe("x")
  })

  test("struct keeps optional fields absent and rejects invalid required ones", () => {
    const codec = Codec.struct({ id: Codec.string, title: Codec.optional(Codec.string), n: Codec.lenientOptional(Codec.number) })
    expect(codec.decode({ id: "1" })).toEqual({ id: "1" })
    expect(codec.decode({ id: "1", title: "t", n: "bad" })).toEqual({ id: "1", title: "t" })
    expect(codec.decode({ id: "1", title: 3 })).toBe(Codec.INVALID)
    expect(codec.decode({ title: "t" })).toBe(Codec.INVALID)
    expect(codec.decode([])).toBe(Codec.INVALID)
    expect(codec.encode({ id: "1" })).toEqual({ id: "1" })
    const value: typeof codec.Type = { id: "1", title: undefined }
    expect(value.id).toBe("1")
  })

  test("lenient collections recover what they can", () => {
    const items = Codec.lenientArray(Codec.struct({ id: Codec.string }))
    expect(items.decode([{ id: "a" }, { id: 1 }, "x", { id: "b" }])).toEqual([{ id: "a" }, { id: "b" }])
    expect(items.decode("nope")).toEqual([])
    expect(Codec.array(Codec.string).decode(["a", 1])).toBe(Codec.INVALID)
    const map = Codec.lenientRecord(Codec.boolean)
    expect(map.decode({ a: true, b: "x" })).toEqual({})
    expect(map.decode({ a: true })).toEqual({ a: true })
  })

  test("union, transform and fallback compose", () => {
    const session = Codec.struct({ type: Codec.literal("session"), id: Codec.string })
    const draft = Codec.struct({ type: Codec.literal("draft"), directory: Codec.string })
    const tab = Codec.union([session, draft])
    expect(tab.decode({ type: "draft", directory: "/x" })).toEqual({ type: "draft", directory: "/x" })
    expect(tab.decode({ type: "other" })).toBe(Codec.INVALID)
    const upper = Codec.transform(Codec.string, { decode: (s) => s.toUpperCase(), encode: (s) => s.toLowerCase() })
    expect(upper.decode("ab")).toBe("AB")
    expect(upper.encode("AB")).toBe("ab")
    const safe = Codec.fallback(Codec.number, () => 7)
    expect(safe.decode("x")).toBe(7)
    expect(safe.decode(undefined)).toBe(7)
    expect(safe.decode(2)).toBe(2)
  })

  test("brand constructs and decodes as its base", () => {
    const Key = Codec.brand<"ServerConnection.Key">()
    const key = Key.make("http://a")
    expect(Key.decode(key)).toBe(key)
    expect(Key.decode(3)).toBe(Codec.INVALID)
  })

  test("withInitial recovers field by field and merges new defaults", () => {
    const layout = Codec.struct({
      sidebar: Codec.struct({ opened: Codec.boolean, width: Codec.number }),
      theme: Codec.lenientOptional(Codec.literals(["light", "dark"])),
    })
    const initial: typeof layout.Type = { sidebar: { opened: true, width: 240 } }
    const codec = Codec.fromJsonString(Codec.withInitial(layout, initial))
    expect(codec.decode(JSON.stringify({ sidebar: { opened: false, width: "wide" }, theme: "dark" }))).toEqual({
      sidebar: { opened: false, width: 240 },
      theme: "dark",
    })
    expect(codec.decode(JSON.stringify({ sidebar: 5 }))).toEqual(initial)
    expect(codec.decode("{not json")).toBe(Codec.INVALID)
    expect(JSON.parse(codec.encode({ sidebar: { opened: true, width: 1 } }))).toEqual({ sidebar: { opened: true, width: 1 } })
  })

  test("migrate reads the old shape first", () => {
    const current = Codec.struct({ tabs: Codec.array(Codec.string) })
    const previous = Codec.struct({ tab: Codec.optional(Codec.string) })
    const read = Codec.transform(previous, {
      decode: (old) => ({ tabs: old.tab ? [old.tab] : [] }),
      encode: (value) => ({ tab: value.tabs[0] }),
    })
    const codec = Codec.withInitial(Codec.migrate(current, read), { tabs: [] })
    expect(codec.decode({ tab: "a" })).toEqual({ tabs: ["a"] })
  })
})
