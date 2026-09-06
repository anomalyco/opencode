import { describe, expect, test } from "bun:test"
import { foldArrayItems } from "../../src/session/llm/request"

const rec = (value: any): any => value

describe("foldArrayItems", () => {
  test("folds items into nullable array type union", () => {
    const schema = {
      type: ["null", "array"],
      items: { type: "string" },
      description: "list of tags",
    }
    const result: any = foldArrayItems(schema)
    expect(result).toEqual({
      anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
      description: "list of tags",
    })
  })

  test("does not mutate the input schema", () => {
    const schema = { type: ["null", "array"], items: { type: "string" } }
    const copy = structuredClone(schema)
    foldArrayItems(schema)
    expect(schema).toEqual(copy)
  })

  test("preserves non-array and non-null members of a multi-type union", () => {
    const result: any = foldArrayItems({ type: ["string", "array"], items: { type: "number" } })
    expect(result.anyOf).toEqual([
      { type: "array", items: { type: "number" } },
      { type: "string" },
    ])
  })

  test("folds items into array-typed anyOf branches", () => {
    const result: any = foldArrayItems({
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
    const result: any = foldArrayItems(schema)
    expect(result.items).toEqual({ type: "string" })
  })

  test("does not fold into allOf branches", () => {
    const schema = { items: { type: "string" }, allOf: [{ type: "array" }] }
    const result: any = foldArrayItems(schema)
    expect(result.items).toEqual({ type: "string" })
    expect((rec(result.allOf)[0] as Record<string, unknown>).items).toBeUndefined()
  })

  test("recurses into nested schemas", () => {
    const result: any = foldArrayItems({
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
    const result: any = foldArrayItems({
      items: { type: "string" },
      anyOf: [{ type: "array", items: own }],
    })
    expect((rec(result.anyOf)[0] as Record<string, unknown>).items).toEqual({ type: "integer" })
  })

  test("is idempotent", () => {
    const once = foldArrayItems({ type: ["null", "array"], items: { type: "string" } })
    const twice = foldArrayItems(once)
    expect(twice).toEqual(once)
  })

  test("returns non-schema objects unchanged", () => {
    const zodLike = { _def: { typeName: "ZodString" }, parse: "not-a-function-here" }
    expect(foldArrayItems(zodLike)).toEqual(zodLike)
    expect(foldArrayItems("scalar")).toEqual("scalar")
    expect(foldArrayItems([1, 2])).toEqual([1, 2])
  })
})
