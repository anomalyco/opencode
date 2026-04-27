import { describe, expect, test } from "bun:test"
import { Effect, Schema, SchemaGetter } from "effect"
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

  describe("Tuples", () => {
    test("fixed-length tuple parses matching array", () => {
      const out = zod(Schema.Tuple([Schema.String, Schema.Number]))
      expect(out.parse(["a", 1])).toEqual(["a", 1])
      expect(out.safeParse(["a"]).success).toBe(false)
      expect(out.safeParse(["a", "b"]).success).toBe(false)
    })

    test("single-element tuple parses a one-element array", () => {
      const out = zod(Schema.Tuple([Schema.Boolean]))
      expect(out.parse([true])).toEqual([true])
      expect(out.safeParse([true, false]).success).toBe(false)
    })

    test("tuple inside a union picks the right branch", () => {
      const out = zod(Schema.Union([Schema.String, Schema.Tuple([Schema.String, Schema.Number])]))
      expect(out.parse("hello")).toBe("hello")
      expect(out.parse(["foo", 42])).toEqual(["foo", 42])
      expect(out.safeParse(["foo"]).success).toBe(false)
    })

    test("plain arrays still work (no element positions)", () => {
      const out = zod(Schema.Array(Schema.String))
      expect(out.parse(["a", "b", "c"])).toEqual(["a", "b", "c"])
      expect(out.parse([])).toEqual([])
    })
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

  describe("Schema.check translation", () => {
    test("filter returning string triggers refinement with that message", () => {
      const isEven = Schema.makeFilter((n: number) => (n % 2 === 0 ? undefined : "expected an even number"))
      const schema = zod(Schema.Number.check(isEven))

      expect(schema.parse(4)).toBe(4)
      const result = schema.safeParse(3)
      expect(result.success).toBe(false)
      expect(result.error!.issues[0].message).toBe("expected an even number")
    })

    test("filter returning false triggers refinement with fallback message", () => {
      const nonEmpty = Schema.makeFilter((s: string) => s.length > 0)
      const schema = zod(Schema.String.check(nonEmpty))

      expect(schema.parse("hi")).toBe("hi")
      const result = schema.safeParse("")
      expect(result.success).toBe(false)
      expect(result.error!.issues[0].message).toMatch(/./)
    })

    test("filter returning undefined passes validation", () => {
      const alwaysOk = Schema.makeFilter(() => undefined)
      const schema = zod(Schema.Number.check(alwaysOk))

      expect(schema.parse(42)).toBe(42)
    })

    test("annotations.message on the filter is used when filter returns false", () => {
      const positive = Schema.makeFilter((n: number) => n > 0, { message: "must be positive" })
      const schema = zod(Schema.Number.check(positive))

      const result = schema.safeParse(-1)
      expect(result.success).toBe(false)
      expect(result.error!.issues[0].message).toBe("must be positive")
    })

    test("cross-field check on a record flags missing key", () => {
      const hasKey = Schema.makeFilter((data: Record<string, { enabled: boolean }>) =>
        "required" in data ? undefined : "missing 'required' key",
      )
      const schema = zod(Schema.Record(Schema.String, Schema.Struct({ enabled: Schema.Boolean })).check(hasKey))

      expect(schema.parse({ required: { enabled: true } })).toEqual({
        required: { enabled: true },
      })

      const result = schema.safeParse({ other: { enabled: true } })
      expect(result.success).toBe(false)
      expect(result.error!.issues[0].message).toBe("missing 'required' key")
    })
  })

  describe("StructWithRest / catchall", () => {
    test("struct with a string-keyed record rest parses known AND extra keys", () => {
      const schema = zod(
        Schema.StructWithRest(
          Schema.Struct({
            apiKey: Schema.optional(Schema.String),
            baseURL: Schema.optional(Schema.String),
          }),
          [Schema.Record(Schema.String, Schema.Unknown)],
        ),
      )

      // Known fields come through as declared
      expect(schema.parse({ apiKey: "sk-x" })).toEqual({ apiKey: "sk-x" })

      // Extra keys are preserved (catchall)
      expect(
        schema.parse({
          apiKey: "sk-x",
          baseURL: "https://api.example.com",
          customField: "anything",
          nested: { foo: 1 },
        }),
      ).toEqual({
        apiKey: "sk-x",
        baseURL: "https://api.example.com",
        customField: "anything",
        nested: { foo: 1 },
      })
    })

    test("catchall value type constrains the extras", () => {
      const schema = zod(
        Schema.StructWithRest(
          Schema.Struct({
            count: Schema.Number,
          }),
          [Schema.Record(Schema.String, Schema.Number)],
        ),
      )

      // Known field + numeric extras
      expect(schema.parse({ count: 10, a: 1, b: 2 })).toEqual({ count: 10, a: 1, b: 2 })

      // Non-numeric extra is rejected
      expect(schema.safeParse({ count: 10, bad: "not a number" }).success).toBe(false)
    })

    test("JSON schema output marks additionalProperties appropriately", () => {
      const schema = zod(
        Schema.StructWithRest(
          Schema.Struct({
            id: Schema.String,
          }),
          [Schema.Record(Schema.String, Schema.Unknown)],
        ),
      )
      const shape = json(schema) as { additionalProperties?: unknown }
      // Presence of `additionalProperties` (truthy or a schema) signals catchall.
      expect(shape.additionalProperties).not.toBe(false)
      expect(shape.additionalProperties).toBeDefined()
    })

    test("plain struct without rest still emits additionalProperties unchanged (regression)", () => {
      const schema = zod(Schema.Struct({ id: Schema.String }))
      expect(schema.parse({ id: "x" })).toEqual({ id: "x" })
    })
  })

  describe("transforms (Schema.decodeTo)", () => {
    test("Number -> pseudo-Duration (seconds) applies the decode function", () => {
      // Models the account/account.ts DurationFromSeconds pattern.
      const SecondsToMs = Schema.Number.pipe(
        Schema.decodeTo(Schema.Number, {
          decode: SchemaGetter.transform((n: number) => n * 1000),
          encode: SchemaGetter.transform((ms: number) => ms / 1000),
        }),
      )

      const schema = zod(SecondsToMs)
      expect(schema.parse(3)).toBe(3000)
      expect(schema.parse(0)).toBe(0)
    })

    test("String -> Number via parseInt decode", () => {
      const ParsedInt = Schema.String.pipe(
        Schema.decodeTo(Schema.Number, {
          decode: SchemaGetter.transform((s: string) => Number.parseInt(s, 10)),
          encode: SchemaGetter.transform((n: number) => String(n)),
        }),
      )

      const schema = zod(ParsedInt)
      expect(schema.parse("42")).toBe(42)
      expect(schema.parse("0")).toBe(0)
    })

    test("transform inside a struct field applies per-field", () => {
      const Field = Schema.Number.pipe(
        Schema.decodeTo(Schema.Number, {
          decode: SchemaGetter.transform((n: number) => n + 1),
          encode: SchemaGetter.transform((n: number) => n - 1),
        }),
      )

      const schema = zod(
        Schema.Struct({
          plain: Schema.Number,
          bumped: Field,
        }),
      )

      expect(schema.parse({ plain: 5, bumped: 10 })).toEqual({ plain: 5, bumped: 11 })
    })

    test("chained decodeTo composes transforms in order", () => {
      // String -> Number (parseInt) -> Number (doubled).
      // Exercises the encoded() reduce, not just a single link.
      const Chained = Schema.String.pipe(
        Schema.decodeTo(Schema.Number, {
          decode: SchemaGetter.transform((s: string) => Number.parseInt(s, 10)),
          encode: SchemaGetter.transform((n: number) => String(n)),
        }),
        Schema.decodeTo(Schema.Number, {
          decode: SchemaGetter.transform((n: number) => n * 2),
          encode: SchemaGetter.transform((n: number) => n / 2),
        }),
      )

      const schema = zod(Chained)
      expect(schema.parse("21")).toBe(42)
      expect(schema.parse("0")).toBe(0)
    })

    test("Schema.Class is unaffected by transform walker (returns plain object, not instance)", () => {
      // Schema.Class uses Declaration + encoding under the hood to construct
      // class instances. The walker must NOT apply that transform, or zod
      // parsing would return class instances instead of plain objects.
      class Method extends Schema.Class<Method>("TxTestMethod")({
        type: Schema.String,
        value: Schema.Number,
      }) {}

      const schema = zod(Method)
      const parsed = schema.parse({ type: "oauth", value: 1 })
      expect(parsed).toEqual({ type: "oauth", value: 1 })
      // Guardrail: ensure we didn't get back a Method instance.
      expect(parsed).not.toBeInstanceOf(Method)
    })
  })

  describe("optimizations", () => {
    test("walk() memoizes by AST identity — same AST node returns same Zod", () => {
      const shared = Schema.Struct({ id: Schema.String, name: Schema.String })
      const left = zod(shared)
      const right = zod(shared)
      expect(left).toBe(right)
    })

    test("nested reuse of the same AST reuses the cached Zod child", () => {
      // Two different parents embed the same inner schema. The inner zod
      // child should be identical by reference inside both parents.
      class Inner extends Schema.Class<Inner>("MemoTestInner")({
        value: Schema.String,
      }) {}

      class OuterA extends Schema.Class<OuterA>("MemoTestOuterA")({
        inner: Inner,
      }) {}

      class OuterB extends Schema.Class<OuterB>("MemoTestOuterB")({
        inner: Inner,
      }) {}

      const shapeA = (zod(OuterA) as any).shape ?? (zod(OuterA) as any)._def?.shape?.()
      const shapeB = (zod(OuterB) as any).shape ?? (zod(OuterB) as any)._def?.shape?.()
      expect(shapeA.inner).toBe(shapeB.inner)
    })

    test("multiple checks run in a single refinement layer (all fire on one value)", () => {
      // Three checks attached to the same schema. All three must run and
      // report — asserting that no check silently got dropped when we
      // flattened into one superRefine.
      const positive = Schema.makeFilter((n: number) => (n > 0 ? undefined : "not positive"))
      const even = Schema.makeFilter((n: number) => (n % 2 === 0 ? undefined : "not even"))
      const under100 = Schema.makeFilter((n: number) => (n < 100 ? undefined : "too big"))

      const schema = zod(Schema.Number.check(positive).check(even).check(under100))

      const neg = schema.safeParse(-3)
      expect(neg.success).toBe(false)
      expect(neg.error!.issues.map((i) => i.message)).toEqual(expect.arrayContaining(["not positive", "not even"]))

      const big = schema.safeParse(101)
      expect(big.success).toBe(false)
      expect(big.error!.issues.map((i) => i.message)).toContain("too big")

      // Passing value satisfies all three
      expect(schema.parse(42)).toBe(42)
    })

    test("FilterGroup flattens into the single refinement layer alongside its siblings", () => {
      const positive = Schema.makeFilter((n: number) => (n > 0 ? undefined : "not positive"))
      const even = Schema.makeFilter((n: number) => (n % 2 === 0 ? undefined : "not even"))
      const group = Schema.makeFilterGroup([positive, even])
      const under100 = Schema.makeFilter((n: number) => (n < 100 ? undefined : "too big"))

      const schema = zod(Schema.Number.check(group).check(under100))

      const bad = schema.safeParse(-3)
      expect(bad.success).toBe(false)
      expect(bad.error!.issues.map((i) => i.message)).toEqual(expect.arrayContaining(["not positive", "not even"]))
    })
  })

  describe("well-known refinement translation", () => {
    test("Schema.isInt emits type: integer in JSON Schema", () => {
      const schema = zod(Schema.Number.check(Schema.isInt()))
      const native = json(z.number().int())
      expect(json(schema)).toEqual(native)
      expect(schema.parse(3)).toBe(3)
      expect(schema.safeParse(1.5).success).toBe(false)
    })

    test("Schema.isGreaterThan(0) emits exclusiveMinimum: 0", () => {
      const schema = zod(Schema.Number.check(Schema.isGreaterThan(0)))
      expect((json(schema) as any).exclusiveMinimum).toBe(0)
      expect(schema.parse(1)).toBe(1)
      expect(schema.safeParse(0).success).toBe(false)
      expect(schema.safeParse(-1).success).toBe(false)
    })

    test("Schema.isGreaterThanOrEqualTo(0) emits minimum: 0", () => {
      const schema = zod(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)))
      expect((json(schema) as any).minimum).toBe(0)
      expect(schema.parse(0)).toBe(0)
      expect(schema.safeParse(-1).success).toBe(false)
    })

    test("Schema.isLessThan(10) emits exclusiveMaximum: 10", () => {
      const schema = zod(Schema.Number.check(Schema.isLessThan(10)))
      expect((json(schema) as any).exclusiveMaximum).toBe(10)
      expect(schema.parse(9)).toBe(9)
      expect(schema.safeParse(10).success).toBe(false)
    })

    test("Schema.isLessThanOrEqualTo(10) emits maximum: 10", () => {
      const schema = zod(Schema.Number.check(Schema.isLessThanOrEqualTo(10)))
      expect((json(schema) as any).maximum).toBe(10)
      expect(schema.parse(10)).toBe(10)
      expect(schema.safeParse(11).success).toBe(false)
    })

    test("Schema.isMultipleOf(5) emits multipleOf: 5", () => {
      const schema = zod(Schema.Number.check(Schema.isMultipleOf(5)))
      expect((json(schema) as any).multipleOf).toBe(5)
      expect(schema.parse(10)).toBe(10)
      expect(schema.safeParse(7).success).toBe(false)
    })

    test("Schema.isFinite validates at runtime", () => {
      const schema = zod(Schema.Number.check(Schema.isFinite()))
      expect(schema.parse(1)).toBe(1)
      expect(schema.safeParse(Infinity).success).toBe(false)
      expect(schema.safeParse(NaN).success).toBe(false)
    })

    test("chained isInt + isGreaterThan(0) matches z.number().int().positive()", () => {
      const schema = zod(Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0)))
      const native = json(z.number().int().positive())
      expect(json(schema)).toEqual(native)
      expect(schema.parse(3)).toBe(3)
      expect(schema.safeParse(0).success).toBe(false)
      expect(schema.safeParse(1.5).success).toBe(false)
    })

    test("chained isInt + isGreaterThanOrEqualTo(0) matches z.number().int().min(0)", () => {
      const schema = zod(Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)))
      const native = json(z.number().int().min(0))
      expect(json(schema)).toEqual(native)
      expect(schema.parse(0)).toBe(0)
      expect(schema.safeParse(-1).success).toBe(false)
    })

    test("Schema.isBetween emits both bounds", () => {
      const schema = zod(Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 10 })))
      const shape = json(schema) as any
      expect(shape.minimum).toBe(1)
      expect(shape.maximum).toBe(10)
      expect(schema.parse(5)).toBe(5)
      expect(schema.safeParse(11).success).toBe(false)
      expect(schema.safeParse(0).success).toBe(false)
    })

    test("Schema.isBetween with exclusive bounds emits exclusiveMinimum/Maximum", () => {
      const schema = zod(
        Schema.Number.check(
          Schema.isBetween({ minimum: 1, maximum: 10, exclusiveMinimum: true, exclusiveMaximum: true }),
        ),
      )
      const shape = json(schema) as any
      expect(shape.exclusiveMinimum).toBe(1)
      expect(shape.exclusiveMaximum).toBe(10)
      expect(schema.parse(5)).toBe(5)
      expect(schema.safeParse(1).success).toBe(false)
      expect(schema.safeParse(10).success).toBe(false)
    })

    test("Schema.isInt32 (FilterGroup) produces integer bounds", () => {
      const schema = zod(Schema.Number.check(Schema.isInt32()))
      const shape = json(schema) as any
      expect(shape.type).toBe("integer")
      expect(shape.minimum).toBe(-2147483648)
      expect(shape.maximum).toBe(2147483647)
      expect(schema.parse(42)).toBe(42)
      expect(schema.safeParse(1.5).success).toBe(false)
      expect(schema.safeParse(2147483648).success).toBe(false)
    })

    test("Schema.isMinLength on string emits minLength", () => {
      const schema = zod(Schema.String.check(Schema.isMinLength(3)))
      expect((json(schema) as any).minLength).toBe(3)
      expect(schema.parse("abc")).toBe("abc")
      expect(schema.safeParse("ab").success).toBe(false)
    })

    test("Schema.isMaxLength on string emits maxLength", () => {
      const schema = zod(Schema.String.check(Schema.isMaxLength(5)))
      expect((json(schema) as any).maxLength).toBe(5)
      expect(schema.parse("abcde")).toBe("abcde")
      expect(schema.safeParse("abcdef").success).toBe(false)
    })

    test("Schema.isLengthBetween on string emits both bounds", () => {
      const schema = zod(Schema.String.check(Schema.isLengthBetween(2, 4)))
      const shape = json(schema) as any
      expect(shape.minLength).toBe(2)
      expect(shape.maxLength).toBe(4)
      expect(schema.parse("abc")).toBe("abc")
      expect(schema.safeParse("a").success).toBe(false)
      expect(schema.safeParse("abcde").success).toBe(false)
    })

    test("Schema.isMinLength on array emits minItems", () => {
      const schema = zod(Schema.Array(Schema.String).check(Schema.isMinLength(1)))
      expect((json(schema) as any).minItems).toBe(1)
      expect(schema.parse(["x"])).toEqual(["x"])
      expect(schema.safeParse([]).success).toBe(false)
    })

    test("Schema.isPattern emits pattern", () => {
      const schema = zod(Schema.String.check(Schema.isPattern(/^per/)))
      expect((json(schema) as any).pattern).toBe("^per")
      expect(schema.parse("per_abc")).toBe("per_abc")
      expect(schema.safeParse("abc").success).toBe(false)
    })

    test("Schema.isStartsWith matches native zod .startsWith() JSON Schema", () => {
      const schema = zod(Schema.String.check(Schema.isStartsWith("per")))
      const native = json(z.string().startsWith("per"))
      expect(json(schema)).toEqual(native)
      expect(schema.parse("per_abc")).toBe("per_abc")
      expect(schema.safeParse("abc").success).toBe(false)
    })

    test("Schema.isEndsWith matches native zod .endsWith() JSON Schema", () => {
      const schema = zod(Schema.String.check(Schema.isEndsWith(".json")))
      const native = json(z.string().endsWith(".json"))
      expect(json(schema)).toEqual(native)
      expect(schema.parse("a.json")).toBe("a.json")
      expect(schema.safeParse("a.txt").success).toBe(false)
    })

    test("Schema.isUUID emits format: uuid", () => {
      const schema = zod(Schema.String.check(Schema.isUUID()))
      expect((json(schema) as any).format).toBe("uuid")
    })

    test("mix of well-known and anonymous filters translates known and reroutes unknown to superRefine", () => {
      // isInt is well-known (translates to .int()); the anonymous filter falls
      // back to superRefine.
      const notSeven = Schema.makeFilter((n: number) => (n !== 7 ? undefined : "no sevens allowed"))
      const schema = zod(Schema.Number.check(Schema.isInt()).check(notSeven))

      const shape = json(schema) as any
      // Well-known translation is preserved — type is integer, not plain number
      expect(shape.type).toBe("integer")

      // Runtime: both constraints fire
      expect(schema.parse(3)).toBe(3)
      expect(schema.safeParse(1.5).success).toBe(false)
      const seven = schema.safeParse(7)
      expect(seven.success).toBe(false)
      expect(seven.error!.issues[0].message).toBe("no sevens allowed")
    })

    test("inside a struct field, well-known refinements propagate through", () => {
      // Mirrors config.ts port: z.number().int().positive().optional()
      const Port = Schema.optional(Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0)))
      const schema = zod(Schema.Struct({ port: Port }))
      const shape = json(schema) as any
      expect(shape.properties.port.type).toBe("integer")
      expect(shape.properties.port.exclusiveMinimum).toBe(0)
    })
  })

  describe("Schema.optionalWith defaults", () => {
    test("parsing undefined returns the default value", () => {
      const schema = zod(
        Schema.Struct({
          mode: Schema.String.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("ctrl-x"))),
        }),
      )
      expect(schema.parse({})).toEqual({ mode: "ctrl-x" })
      expect(schema.parse({ mode: undefined })).toEqual({ mode: "ctrl-x" })
    })

    test("parsing a real value returns that value (default does not fire)", () => {
      const schema = zod(
        Schema.Struct({
          mode: Schema.String.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("ctrl-x"))),
        }),
      )
      expect(schema.parse({ mode: "ctrl-y" })).toEqual({ mode: "ctrl-y" })
    })

    test("default on a number field", () => {
      const schema = zod(
        Schema.Struct({
          count: Schema.Number.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(42))),
        }),
      )
      expect(schema.parse({})).toEqual({ count: 42 })
      expect(schema.parse({ count: 7 })).toEqual({ count: 7 })
    })

    test("multiple defaulted fields inside a struct", () => {
      const schema = zod(
        Schema.Struct({
          leader: Schema.String.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("ctrl-x"))),
          quit: Schema.String.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("ctrl-c"))),
          inner: Schema.String,
        }),
      )
      expect(schema.parse({ inner: "hi" })).toEqual({
        leader: "ctrl-x",
        quit: "ctrl-c",
        inner: "hi",
      })
      expect(schema.parse({ leader: "a", quit: "b", inner: "c" })).toEqual({
        leader: "a",
        quit: "b",
        inner: "c",
      })
    })

    test("JSON Schema output includes the default key", () => {
      const schema = zod(
        Schema.Struct({
          mode: Schema.String.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("ctrl-x"))),
        }),
      )
      const shape = json(schema) as any
      expect(shape.properties.mode.default).toBe("ctrl-x")
    })

    test("default referencing a computed value resolves when evaluated", () => {
      // Simulates `keybinds.ts` style of per-platform defaults: the default is
      // produced by an Effect that computes a value at decode time.
      const platform = "darwin"
      const fallback = platform === "darwin" ? "cmd-k" : "ctrl-k"
      const schema = zod(
        Schema.Struct({
          command_palette: Schema.String.pipe(Schema.optional, Schema.withDecodingDefault(Effect.sync(() => fallback))),
        }),
      )
      expect(schema.parse({})).toEqual({ command_palette: "cmd-k" })
      const shape = json(schema) as any
      expect(shape.properties.command_palette.default).toBe("cmd-k")
    })

    test("plain Schema.optional (no default) still emits .optional() (regression)", () => {
      const schema = zod(Schema.Struct({ foo: Schema.optional(Schema.String) }))
      expect(schema.parse({})).toEqual({})
      expect(schema.parse({ foo: "hi" })).toEqual({ foo: "hi" })
    })
  })
})
