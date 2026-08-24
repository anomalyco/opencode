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

test("preserves authored synthetic-looking names without an anonymous family root", () => {
  const result = stabilizeOpenApi({
    components: { schemas: { Union_2: { type: "string" } } },
  }) as { components: { schemas: Record<string, unknown> } }

  expect(result.components.schemas.Union_2).toEqual({ type: "string" })
})
