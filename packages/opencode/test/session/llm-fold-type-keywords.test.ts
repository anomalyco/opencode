import { describe, expect, test } from "bun:test"
import { foldTypeKeywords } from "../../src/session/llm/request"

const rec = (value: any): any => value

describe("foldTypeKeywords", () => {
  test("folds items into nullable array type union", () => {
    const schema = {
      type: ["null", "array"],
      items: { type: "string" },
      description: "list of tags",
    }
    const result: any = foldTypeKeywords(schema)
    expect(result).toEqual({
      anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
      description: "list of tags",
    })
  })

  test("does not mutate the input schema", () => {
    const schema = { type: ["null", "array"], items: { type: "string" } }
    const copy = structuredClone(schema)
    foldTypeKeywords(schema)
    expect(schema).toEqual(copy)
  })

  test("preserves non-array and non-null members of a multi-type union", () => {
    const result: any = foldTypeKeywords({ type: ["string", "array"], items: { type: "number" } })
    expect(result.anyOf).toEqual([
      { type: "array", items: { type: "number" } },
      { type: "string" },
    ])
  })

  test("folds items into array-typed anyOf branches", () => {
    const result: any = foldTypeKeywords({
      items: { type: "string" },
      anyOf: [{ type: "array" }, { type: "object", properties: {} }],
    })
    expect(result).toEqual({
      anyOf: [{ type: "array", items: { type: "string" } }, { type: "object", properties: {} }],
    })
  })

  test("keeps items on the parent when no combiner branch is array-typed", () => {
    const schema = {
      items: { type: "string" },
      anyOf: [{ type: "string" }, { type: "number" }],
    }
    const result: any = foldTypeKeywords(schema)
    expect(result.items).toEqual({ type: "string" })
  })

  test("does not fold into allOf branches", () => {
    const schema = { items: { type: "string" }, allOf: [{ type: "array" }] }
    const result: any = foldTypeKeywords(schema)
    expect(result.items).toEqual({ type: "string" })
    expect((rec(result.allOf)[0] as Record<string, unknown>).items).toBeUndefined()
  })

  test("recurses into nested schemas", () => {
    const result: any = foldTypeKeywords({
      properties: {
        nested: { type: ["null", "array"], items: { type: "boolean" } },
      },
    })
    expect(result.properties).toEqual({
      nested: { anyOf: [{ type: "array", items: { type: "boolean" } }, { type: "null" }] },
    })
  })

  test("leaves existing branch items untouched", () => {
    const own = { type: "integer" }
    const result: any = foldTypeKeywords({
      items: { type: "string" },
      anyOf: [{ type: "array", items: own }],
    })
    expect((rec(result.anyOf)[0] as Record<string, unknown>).items).toEqual({ type: "integer" })
  })

  test("is idempotent", () => {
    const once = foldTypeKeywords({ type: ["null", "array"], items: { type: "string" } })
    const twice = foldTypeKeywords(once)
    expect(twice).toEqual(once)
  })

  test("returns non-schema objects unchanged", () => {
    const zodLike = { _def: { typeName: "ZodString" }, parse: "not-a-function-here" }
    expect(foldTypeKeywords(zodLike)).toEqual(zodLike)
    expect(foldTypeKeywords("scalar")).toEqual("scalar")
    expect(foldTypeKeywords([1, 2])).toEqual([1, 2])
  })

  test("folds properties and required into nullable object type union", () => {
    const result: any = foldTypeKeywords({
      type: ["object", "null"],
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
      description: "owner",
    })
    expect(result).toEqual({
      anyOf: [
        { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
        { type: "null" },
      ],
      description: "owner",
    })
  })

  test("splits array and object keywords into their own branches", () => {
    const result: any = foldTypeKeywords({
      type: ["array", "object"],
      items: { type: "string" },
      minItems: 1,
      properties: { a: { type: "number" } },
    })
    expect(result.anyOf).toEqual([
      { type: "array", items: { type: "string" }, minItems: 1 },
      { type: "object", properties: { a: { type: "number" } } },
    ])
  })

  test("leaves keywords whose type is not in the union on the parent", () => {
    const result: any = foldTypeKeywords({
      type: ["array", "null"],
      items: { type: "string" },
      properties: { a: { type: "number" } },
    })
    expect(result.properties).toEqual({ a: { type: "number" } })
    expect(result.anyOf[0]).toEqual({ type: "array", items: { type: "string" } })
  })

  test("folds properties into object-typed anyOf branches", () => {
    const result: any = foldTypeKeywords({
      properties: { a: { type: "string" } },
      required: ["a"],
      anyOf: [{ type: "object" }, { type: "null" }],
    })
    expect(result).toEqual({
      anyOf: [{ type: "object", properties: { a: { type: "string" } }, required: ["a"] }, { type: "null" }],
    })
  })

  test("keeps keywords on a parent with its own single type", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" } },
      anyOf: [{ type: "object", required: ["a"] }],
    }
    expect(foldTypeKeywords(schema)).toEqual(schema)
  })

  test("leaves single-type schemas untouched", () => {
    const schema = { type: "object", properties: { tags: { type: "array", items: { type: "string" } } } }
    expect(foldTypeKeywords(schema)).toEqual(schema)
  })
})
