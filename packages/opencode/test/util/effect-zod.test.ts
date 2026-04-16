import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import z from "zod"

import { zod, ZodOverride } from "../../src/util/effect-zod"

function json(schema: z.ZodTypeAny) {
  const { $schema: _, ...rest } = z.toJSONSchema(schema)
  return rest
}

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

  test("string literal unions produce z.enum with enum in JSON Schema", () => {
    const Action = Schema.Literals(["allow", "deny", "ask"])
    const out = zod(Action)

    expect(out.parse("allow")).toBe("allow")
    expect(out.parse("deny")).toBe("deny")
    expect(() => out.parse("nope")).toThrow()

    // Matches native z.enum JSON Schema output
    const bridged = json(out)
    const native = json(z.enum(["allow", "deny", "ask"]))
    expect(bridged).toEqual(native)
    expect(bridged.enum).toEqual(["allow", "deny", "ask"])
  })

  test("ZodOverride annotation provides the Zod schema for branded IDs", () => {
    const override = z.string().startsWith("per")
    const ID = Schema.String.annotate({ [ZodOverride]: override }).pipe(Schema.brand("TestID"))

    const Parent = Schema.Struct({ id: ID, name: Schema.String })
    const out = zod(Parent)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((out as any).parse({ id: "per_abc", name: "test" })).toEqual({ id: "per_abc", name: "test" })

    const schema = json(out) as any
    expect(schema.properties.id).toEqual({ type: "string", pattern: "^per.*" })
  })

  test("Schema.Class nested in a parent preserves ref via identifier", () => {
    class Inner extends Schema.Class<Inner>("MyInner")({
      value: Schema.String,
    }) {}

    class Outer extends Schema.Class<Outer>("MyOuter")({
      inner: Inner,
    }) {}

    const out = zod(Outer)
    expect(out.meta()?.ref).toBe("MyOuter")

    const shape = (out as any).shape ?? (out as any)._def?.shape?.()
    expect(shape.inner.meta()?.ref).toBe("MyInner")
  })

  test("Schema.Class preserves identifier and uses enum format", () => {
    class Rule extends Schema.Class<Rule>("PermissionRule")({
      permission: Schema.String,
      pattern: Schema.String,
      action: Schema.Literals(["allow", "deny", "ask"]),
    }) {}

    const out = zod(Rule)
    expect(out.meta()?.ref).toBe("PermissionRule")

    const schema = json(out) as any
    expect(schema.properties.action).toEqual({
      type: "string",
      enum: ["allow", "deny", "ask"],
    })
  })

  test("ZodOverride on ID carries pattern through Schema.Class", () => {
    const ID = Schema.String.annotate({
      [ZodOverride]: z.string().startsWith("per"),
    })

    class Request extends Schema.Class<Request>("TestRequest")({
      id: ID,
      name: Schema.String,
    }) {}

    const schema = json(zod(Request)) as any
    expect(schema.properties.id).toEqual({ type: "string", pattern: "^per.*" })
    expect(schema.properties.name).toEqual({ type: "string" })
  })

  test("Permission schemas match original Zod equivalents", () => {
    const MsgID = Schema.String.annotate({ [ZodOverride]: z.string().startsWith("msg") })
    const PerID = Schema.String.annotate({ [ZodOverride]: z.string().startsWith("per") })
    const SesID = Schema.String.annotate({ [ZodOverride]: z.string().startsWith("ses") })

    class Tool extends Schema.Class<Tool>("PermissionTool")({
      messageID: MsgID,
      callID: Schema.String,
    }) {}

    class Request extends Schema.Class<Request>("PermissionRequest")({
      id: PerID,
      sessionID: SesID,
      permission: Schema.String,
      patterns: Schema.Array(Schema.String),
      metadata: Schema.Record(Schema.String, Schema.Unknown),
      always: Schema.Array(Schema.String),
      tool: Schema.optional(Tool),
    }) {}

    const bridged = json(zod(Request)) as any
    expect(bridged.properties.id).toEqual({ type: "string", pattern: "^per.*" })
    expect(bridged.properties.sessionID).toEqual({ type: "string", pattern: "^ses.*" })
    expect(bridged.properties.permission).toEqual({ type: "string" })
    expect(bridged.required?.sort()).toEqual(["id", "sessionID", "permission", "patterns", "metadata", "always"].sort())

    // Tool field is present with the ref from Schema.Class identifier
    const toolSchema = json(zod(Tool)) as any
    expect(toolSchema.properties.messageID).toEqual({ type: "string", pattern: "^msg.*" })
    expect(toolSchema.properties.callID).toEqual({ type: "string" })
  })

  test("ZodOverride survives Schema.brand", () => {
    const override = z.string().startsWith("ses")
    const ID = Schema.String.annotate({ [ZodOverride]: override }).pipe(Schema.brand("SessionID"))

    // The branded schema's AST still has the override
    class Parent extends Schema.Class<Parent>("Parent")({
      sessionID: ID,
    }) {}

    const schema = json(zod(Parent)) as any
    expect(schema.properties.sessionID).toEqual({ type: "string", pattern: "^ses.*" })
  })
})
