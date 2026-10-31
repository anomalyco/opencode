import { expect, test } from "bun:test"
import { stabilizeOpenApi } from "../script/openapi-stabilize.js"

test("content-addresses anonymous components without changing reference siblings", () => {
  const result = stabilizeOpenApi({
    components: {
      schemas: {
        Union_: { anyOf: [{ type: "string" }, { type: "null" }] },
        Union_2: { type: "number" },
        OAuth_2: { type: "string" },
      },
    },
    paths: {
      "/test": {
        schema: { $ref: "#/components/schemas/Union_", description: "nullable value" },
      },
    },
  }) as {
    components: { schemas: Record<string, unknown> }
    paths: { "/test": { schema: { $ref: string; description: string } } }
  }

  expect(result.paths["/test"].schema.description).toBe("nullable value")
  expect(result.paths["/test"].schema.$ref).toMatch(/^#\/components\/schemas\/Union_[a-f0-9]{12}$/)
  expect(result.components.schemas.OAuth_2).toEqual({ type: "string" })
})

test("keeps anonymous names stable across encounter order and nested ordinals", () => {
  const generate = (nested: string, parent: string) =>
    stabilizeOpenApi({
      components: {
        schemas: {
          Union_: { type: "boolean" },
          Arrays_: { type: "array", items: { type: "boolean" } },
          [parent]: { type: "array", items: { $ref: `#/components/schemas/${nested}` } },
          [nested]: { type: "string" },
        },
      },
    }) as { components: { schemas: Record<string, unknown> } }

  expect(generate("Union_1", "Arrays_2")).toEqual(generate("Union_9", "Arrays_7"))
})

test("merges structurally identical anonymous components", () => {
  const result = stabilizeOpenApi({
    components: {
      schemas: {
        Union_: { type: "string" },
        Union_2: { type: "string" },
      },
    },
  }) as { components: { schemas: Record<string, unknown> } }

  expect(Object.keys(result.components.schemas)).toHaveLength(1)
})

test("includes reference siblings in anonymous component hashes", () => {
  const result = stabilizeOpenApi({
    components: {
      schemas: {
        Union_: { type: "string" },
        Arrays_: { type: "array", items: { $ref: "#/components/schemas/Union_", description: "first" } },
        Arrays_2: { type: "array", items: { $ref: "#/components/schemas/Union_", description: "second" } },
      },
    },
  }) as { components: { schemas: Record<string, unknown> } }

  expect(Object.keys(result.components.schemas).filter((name) => name.startsWith("Arrays_"))).toHaveLength(2)
})

test("content-addresses encounter-order names of encoded variants", () => {
  const generate = (one: string, two: string) =>
    stabilizeOpenApi({
      components: {
        schemas: {
          [one]: { type: "number", enum: [1] },
          [two]: { type: "number", enum: [2] },
          Event: { anyOf: [{ $ref: `#/components/schemas/${one}` }, { $ref: `#/components/schemas/${two}` }] },
        },
      },
    }) as { components: { schemas: Record<string, unknown> } }

  const result = generate("Event.VersionEncoded_47", "Event.VersionEncoded_37")
  expect(result).toEqual(generate("Event.VersionEncoded_3", "Event.VersionEncoded_9"))
  expect(
    Object.keys(result.components.schemas).filter((name) => /^Event\.VersionEncoded_[a-f0-9]{12}$/.test(name)),
  ).toHaveLength(2)
})

test("folds numbered copies of a named component only when they are deeply equal", () => {
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
  const result = stabilizeOpenApi({
    components: {
      schemas: {
        Info: { type: "object", properties: { content: ref("Content") }, required: ["content"] },
        Info_1: { required: ["content"], properties: { content: ref("Content_1") }, type: "object" },
        Content: { type: "string" },
        Content_1: { type: "string" },
        Field: { type: "object", properties: { value: ref("Value") } },
        Field_1: { type: "object", properties: { value: ref("Value_1") } },
        Value: { type: "string", enum: ["a", "b"] },
        Value_1: { type: "string", enum: ["b", "a"] },
      },
    },
    paths: { "/info": { schema: ref("Info_1") }, "/field": { schema: ref("Field_1") } },
  }) as {
    components: { schemas: Record<string, unknown> }
    paths: Record<string, { schema: { $ref: string } }>
  }

  expect(Object.keys(result.components.schemas).sort()).toEqual([
    "Content",
    "Field",
    "Field_1",
    "Info",
    "Value",
    "Value_1",
  ])
  expect(result.paths["/info"].schema).toEqual(ref("Info"))
  expect(result.paths["/field"].schema).toEqual(ref("Field_1"))
  expect(result.components.schemas.Field_1).toEqual({ type: "object", properties: { value: ref("Value_1") } })
})

test("preserves authored synthetic-looking names without an anonymous family root", () => {
  const result = stabilizeOpenApi({
    components: { schemas: { Union_2: { type: "string" } } },
  }) as { components: { schemas: Record<string, unknown> } }

  expect(result.components.schemas.Union_2).toEqual({ type: "string" })
})
