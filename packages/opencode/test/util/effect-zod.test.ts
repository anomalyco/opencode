import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import { zod } from "../../src/util/effect-zod"

describe("util.effect-zod", () => {
  test("converts class schemas for route dto shapes", () => {
    class Method extends Schema.Class<Method>("ProviderAuthMethod")({
      type: Schema.Union([Schema.Literal("oauth"), Schema.Literal("api")]),
      label: Schema.String,
    }) {}

    const out = zod(Method)

    expect(out.meta()?.ref).toBe("ProviderAuthMethod")
    expect(
      out.parse({
        type: "oauth",
        label: "OAuth",
      }),
    ).toEqual({
      type: "oauth",
      label: "OAuth",
    })
  })

  test("converts structs with optional fields, arrays, and records", () => {
    const out = zod(
      Schema.Struct({
        foo: Schema.optional(Schema.String),
        bar: Schema.Array(Schema.Number),
        baz: Schema.Record(Schema.String, Schema.Boolean),
      }),
    )

    expect(
      out.parse({
        bar: [1, 2],
        baz: { ok: true },
      }),
    ).toEqual({
      bar: [1, 2],
      baz: { ok: true },
    })
    expect(
      out.parse({
        foo: "hi",
        bar: [1],
        baz: { ok: false },
      }),
    ).toEqual({
      foo: "hi",
      bar: [1],
      baz: { ok: false },
    })
  })

  test("throws for unsupported tuple schemas", () => {
    expect(() => zod(Schema.Tuple([Schema.String, Schema.Number]))).toThrow("unsupported effect schema")
  })
})
