import { describe, expect, test } from "bun:test"
import { Effect, Schema, SchemaGetter } from "effect"
import { Persistence } from "./schema"

describe("persistence schemas", () => {
  test("initial state supplies nested defaults without hiding valid siblings", () => {
    const schema = Persistence.withInitial(
      Persistence.struct({
        enabled: Schema.Boolean,
        appearance: Persistence.struct({ width: Schema.Number, font: Schema.String }),
        variant: Schema.optional(Schema.NullOr(Schema.String)),
      }),
      { enabled: true, appearance: { width: 240, font: "default" }, variant: "high" },
    )
    const decode = Schema.decodeUnknownSync(schema)
    expect(decode({ appearance: { width: 300 } })).toEqual({
      enabled: true,
      appearance: { width: 300, font: "default" },
      variant: "high",
    })
    expect(decode({ enabled: "false", appearance: { width: "wide", font: "saved" }, variant: null })).toEqual({
      enabled: true,
      appearance: { width: 240, font: "saved" },
      variant: null,
    })
    expect(decode({ appearance: null })).toEqual({
      enabled: true,
      appearance: { width: 240, font: "default" },
      variant: "high",
    })
  })

  test("legacy migration observes missing fields before initial defaults are applied", () => {
    const current = Persistence.struct({ mode: Schema.Literals(["compact", "full"]), enabled: Schema.Boolean })
    const stored = Schema.Struct({
      mode: Schema.optional(Schema.Unknown),
      expanded: Schema.optional(Schema.Boolean),
    }).pipe(
      Schema.decode({
        decode: SchemaGetter.transform((value) =>
          value.mode !== undefined || value.expanded === undefined
            ? value
            : { ...value, mode: value.expanded ? "full" : "compact" },
        ),
        encode: SchemaGetter.passthrough(),
      }),
    )
    const schema = Persistence.withInitial(Persistence.migrate(current, stored), { mode: "compact", enabled: true })
    const decode = Schema.decodeUnknownSync(schema)
    expect(decode({ expanded: true, enabled: false })).toEqual({ mode: "full", enabled: false })
    expect(decode({ expanded: true, mode: "compact" })).toEqual({ mode: "compact", enabled: true })
    expect(decode({ expanded: true, mode: "invalid" })).toEqual({ mode: "compact", enabled: true })
    expect(Schema.encodeSync(schema)(decode({ expanded: true }))).toEqual({ mode: "full", enabled: true })
  })

  test("initial merging preserves field codecs and replaces arrays rather than merging indexes", () => {
    const current = Persistence.struct({
      amount: Schema.NumberFromString.check(Schema.isFinite()),
      items: Schema.mutable(Schema.Array(Schema.String)),
    })
    const schema = Persistence.withInitial(current, { amount: 7, items: ["initial"] })
    const decode = Schema.decodeUnknownSync(schema)
    expect(decode({ amount: "12", items: [] })).toEqual({ amount: 12, items: [] })
    expect(decode({ amount: "invalid", items: ["saved"] })).toEqual({ amount: 7, items: ["saved"] })
    expect(Schema.encodeSync(schema)(decode({}))).toEqual({ amount: "7", items: ["initial"] })
  })

  test("built-in defaults only recover absent values, not invalid ones", () => {
    const schema = Persistence.struct({
      enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
    })
    const decode = Schema.decodeUnknownSync(schema)
    expect(decode({})).toEqual({ enabled: true })
    expect(decode({ enabled: undefined })).toEqual({ enabled: true })
    expect(() => decode({ enabled: "true" })).toThrow()
    const state: typeof schema.Type = { enabled: false }
    state.enabled = true
    expect(Schema.encodeSync(schema)(state)).toEqual({ enabled: true })
  })

  test("defaults missing and invalid fields without discarding valid siblings", () => {
    const schema = Schema.Struct({
      enabled: Persistence.fallback(Schema.Boolean, () => true),
      label: Persistence.fallback(Schema.String, () => "default"),
    })
    const decode = Schema.decodeUnknownSync(schema)
    expect(decode({})).toEqual({ enabled: true, label: "default" })
    expect(decode({ enabled: "false", label: "saved" })).toEqual({ enabled: true, label: "saved" })
    expect(decode({ enabled: undefined, label: null })).toEqual({ enabled: true, label: "default" })
    expect(Schema.encodeSync(schema)(decode({}))).toEqual({ enabled: true, label: "default" })
  })

  test("optional recovery keeps fields optional without adding an undefined default", () => {
    const number = Schema.NumberFromString.check(Schema.isFinite())
    const schema = Persistence.struct({ value: Persistence.optional(number) })
    const decode = Schema.decodeUnknownSync(schema)
    const empty: typeof schema.Type = {}
    expect(decode({})).toEqual(empty)
    expect(decode({ value: "invalid" })).toEqual(empty)
    expect(Object.hasOwn(decode({ value: "invalid" }), "value")).toBe(false)
    expect(decode({ value: undefined })).toEqual({ value: undefined })
    expect(decode({ value: "42" })).toEqual({ value: 42 })
    expect(Schema.encodeSync(schema)({ value: 42 })).toEqual({ value: "42" })
    expect(Schema.encodeSync(schema)(empty)).toEqual({})
    expect(() =>
      Schema.decodeUnknownSync(Schema.Struct({ value: Schema.optional(number) }))({ value: "invalid" }),
    ).toThrow()
  })

  test("fallbacks use decoded values and retain the codec on writes", () => {
    const schema = Persistence.struct({
      value: Persistence.fallback(Schema.NumberFromString.check(Schema.isFinite()), () => 7),
    })
    const decode = Schema.decodeUnknownSync(schema)
    expect(decode({})).toEqual({ value: 7 })
    expect(decode({ value: "invalid" })).toEqual({ value: 7 })
    expect(Schema.encodeSync(schema)(decode({}))).toEqual({ value: "7" })
  })

  test("records default to fresh mutable objects and keep entry recovery explicit", () => {
    const strict = Persistence.record(Schema.Boolean)
    const decode = Schema.decodeUnknownSync(strict)
    expect(decode(undefined)).toEqual({})
    expect(decode([])).toEqual({})
    expect(decode({ valid: true, invalid: "true" })).toEqual({})
    const first: typeof strict.Type = decode(undefined)
    first.changed = true
    expect(decode(undefined)).toEqual({})

    const recover = Persistence.record(Persistence.optional(Schema.Boolean))
    const state = Schema.decodeUnknownSync(recover)({ valid: true, invalid: "true" })
    expect(state).toEqual({ valid: true })
    expect(Schema.encodeSync(recover)(state)).toEqual({ valid: true })
  })

  test("creates fresh default collections", () => {
    const schema = Schema.Struct({ items: Persistence.array(Schema.String) })
    const decode = Schema.decodeUnknownSync(schema)
    const first = decode({})
    first.items.push("changed")
    expect(decode({}).items).toEqual([])
  })

  test("recovers and migrates individual array entries", () => {
    const current = Schema.Struct({ name: Schema.String })
    const schema = Persistence.array(
      Schema.Union([current, Schema.String]).pipe(
        Schema.decodeTo(current, {
          decode: SchemaGetter.transform((value) => (typeof value === "string" ? { name: value } : value)),
          encode: SchemaGetter.passthrough(),
        }),
      ),
    )
    const decode = Schema.decodeUnknownSync(schema)
    const value = decode(["old", { name: "new" }, null, { name: false }])
    expect(value).toEqual([{ name: "old" }, { name: "new" }])
    expect(Schema.encodeSync(schema)(value)).toEqual(value)
    expect(decode(Schema.encodeSync(schema)(value))).toEqual(value)
    expect(decode(undefined)).toEqual([])
    expect(decode({})).toEqual([])
  })
})
