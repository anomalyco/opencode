import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

const geminiModel = {
  providerID: "google",
  api: {
    id: "gemini-3-pro",
  },
} as any

describe("ProviderTransform.schema - sanitizeGemini", () => {
  test("infers object type for empty root schema", () => {
    const result = ProviderTransform.schema(geminiModel, {} as any) as any
    expect(result.type).toBe("object")
  })

  test("strips additionalProperties", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      additionalProperties: false,
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any
    expect(result.additionalProperties).toBeUndefined()
  })

  test("converts anyOf const variants to string enum", () => {
    const schema = {
      type: "object",
      properties: {
        status: {
          anyOf: [{ const: 1 }, { const: 2 }, { const: 3 }],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any
    expect(result.properties.status.type).toBe("string")
    expect(result.properties.status.enum).toEqual(["1", "2", "3"])
    expect(result.properties.status.anyOf).toBeUndefined()
  })

  test("resolves local $ref from $defs and merges sibling fields", () => {
    const schema = {
      type: "object",
      $defs: {
        Address: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
          required: ["city"],
          additionalProperties: false,
        },
      },
      properties: {
        shippingAddress: {
          $ref: "#/$defs/Address",
          description: "Shipping address",
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any
    expect(result.$defs).toBeUndefined()
    expect(result.properties.shippingAddress.type).toBe("object")
    expect(result.properties.shippingAddress.description).toBe("Shipping address")
    expect(result.properties.shippingAddress.properties.city.type).toBe("string")
    expect(result.properties.shippingAddress.required).toEqual(["city"])
    expect(result.properties.shippingAddress.additionalProperties).toBeUndefined()
  })

  test("merges allOf properties and required fields", () => {
    const schema = {
      type: "object",
      properties: {
        profile: {
          allOf: [
            {
              type: "object",
              properties: {
                name: { type: "string" },
              },
              required: ["name"],
            },
            {
              properties: {
                age: { type: "integer" },
              },
              required: ["age"],
            },
          ],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any
    expect(result.properties.profile.type).toBe("object")
    expect(result.properties.profile.properties.name.type).toBe("string")
    expect(result.properties.profile.properties.age.type).toBe("integer")
    expect([...result.properties.profile.required].sort()).toEqual(["age", "name"])
    expect(result.properties.profile.allOf).toBeUndefined()
  })

  test("sanitizes nested schemas recursively", () => {
    const schema = {
      type: "object",
      properties: {
        nested: {
          type: "object",
          additionalProperties: false,
          properties: {
            choice: {
              anyOf: [{ const: "A" }, { const: "B" }],
            },
            external: {
              $ref: "https://example.com/schemas/external.json",
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any
    expect(result.properties.nested.additionalProperties).toBeUndefined()
    expect(result.properties.nested.properties.choice.enum).toEqual(["A", "B"])
    expect(result.properties.nested.properties.choice.anyOf).toBeUndefined()
    expect(result.properties.nested.properties.external.$ref).toBeUndefined()
  })

  test("removes object-only keys from non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        invalidString: {
          type: "string",
          properties: {
            bad: { type: "string" },
          },
          required: ["bad"],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any
    expect(result.properties.invalidString.type).toBe("string")
    expect(result.properties.invalidString.properties).toBeUndefined()
    expect(result.properties.invalidString.required).toBeUndefined()
  })
})
