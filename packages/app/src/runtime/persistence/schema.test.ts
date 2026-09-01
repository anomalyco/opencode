import { describe, expect, test } from "bun:test"
import { Schema, SchemaGetter } from "effect"
import { Persistence } from "./schema"

describe("persistence schemas", () => {
  test("defaults missing and invalid fields without discarding valid siblings", () => {
    const schema = Schema.Struct({
      enabled: Persistence.defaulted(Schema.Boolean, () => true),
      label: Persistence.defaulted(Schema.String, () => "default"),
    })
    const decode = Schema.decodeUnknownSync(schema)
    expect(decode({})).toEqual({ enabled: true, label: "default" })
    expect(decode({ enabled: "false", label: "saved" })).toEqual({ enabled: true, label: "saved" })
    expect(decode({ enabled: undefined, label: null })).toEqual({ enabled: true, label: "default" })
    expect(Schema.encodeSync(schema)(decode({}))).toEqual({ enabled: true, label: "default" })
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
