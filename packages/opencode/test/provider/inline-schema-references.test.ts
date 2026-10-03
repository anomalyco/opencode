import { describe, expect, it } from "bun:test"
import { inlineSchemaReferences } from "../../src/provider/inline-schema-references"

describe("inlineSchemaReferences", () => {
  it("expands repeated references without changing definitions or the original schema", () => {
    const settings = {
      type: "object",
      properties: { notifications: { type: "boolean" } },
      required: ["notifications"],
      additionalProperties: false,
    }
    const schema = {
      type: "object",
      properties: {
        settings: { $ref: "#/$defs/Settings" },
        other: { $ref: "#/$defs/Settings", description: "Another check" },
      },
      $defs: { Settings: settings },
    }
    const before = structuredClone(schema)
    expect(inlineSchemaReferences(schema)).toEqual({
      ...schema,
      properties: { settings, other: { ...settings, description: "Another check" } },
    })
    expect(schema).toEqual(before)
  })

  it("handles nested arrays, unions, escaped names, and legacy definitions", () => {
    const schema = {
      type: "array",
      items: { anyOf: [{ $ref: "#/definitions/A~1B~0C" }, { type: "null" }] },
      definitions: { "A/B~C": { $ref: "#/definitions/Value" }, Value: { type: "integer", minimum: 2 } },
    }
    expect(inlineSchemaReferences(schema).items).toEqual({
      anyOf: [{ type: "integer", minimum: 2 }, { type: "null" }],
    })
  })

  it("does not interpret example/default values or property names as schema keywords", () => {
    const data = { $ref: "#/missing", properties: { $ref: "literal" } }
    const schema = {
      type: "object",
      properties: { $ref: { type: "string" } },
      default: data,
      examples: [data],
      enum: [data],
    }
    expect(inlineSchemaReferences(schema)).toEqual(schema)
  })

  it.each([
    { $ref: "https://example.com/schema" },
    { $ref: "#/$defs/Missing" },
    { $ref: "#/$defs/%ZZ" },
    {
      properties: { root: { $ref: "#/$defs/Node" } },
      $defs: { Node: { type: "object", properties: { next: { $ref: "#/$defs/Node" } } } },
    },
    { $id: "https://example.com/schema", type: "object" },
    {
      properties: { value: { $ref: "#/$defs/Value", minimum: 10 } },
      $defs: { Value: { type: "integer", minimum: 2 } },
    },
  ])("keeps unsupported references and scopes intact: %j", (schema) => {
    expect(inlineSchemaReferences(schema)).toBe(schema)
  })

  it("preserves boolean schemas", () => {
    const schema = { properties: { forbidden: { $ref: "#/$defs/Never" } }, $defs: { Never: false } }
    expect(inlineSchemaReferences(schema)).toMatchObject({ properties: { forbidden: false } })
  })

  it("bounds expansion of a branching reference graph", () => {
    const definitions: Record<string, unknown> = { End: { type: "string" } }
    for (let index = 0; index < 20; index++) {
      const child = { $ref: `#/$defs/${index === 19 ? "End" : index + 1}` }
      definitions[index] = { type: "object", properties: { left: child, right: child } }
    }
    const schema = { properties: { value: { $ref: "#/$defs/0" } }, $defs: definitions }
    expect(inlineSchemaReferences(schema)).toBe(schema)
  })
})
