import { expect, test } from "bun:test"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ClientApi } from "../src/client.js"
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

test("extracts shared parameters used by two or more operations into components.parameters", () => {
  const ItemID = Schema.String.check(Schema.isStartingWith("itm_")).annotate({
    identifier: "Item.ID",
  })

  const api = HttpApi.make("test").add(
    HttpApiGroup.make("items")
      .add(
        HttpApiEndpoint.get("list", "/items", {
          query: { cursor: Schema.optional(Schema.String) },
        }),
      )
      .add(
        HttpApiEndpoint.get("getBySchema", "/items/:id", {
          params: { id: ItemID },
        }),
      )
      .add(
        HttpApiEndpoint.delete("removeBySchema", "/items/:id", {
          params: { id: ItemID },
        }),
      )
      .add(
        HttpApiEndpoint.get("getByRawId", "/raw/:id", {
          params: { id: Schema.String },
        }),
      )
      .add(
        HttpApiEndpoint.delete("removeByRawId", "/raw/:id", {
          params: { id: Schema.String },
        }),
      ),
  )

  const result = stabilizeOpenApi(OpenApi.fromApi(api))
  expect(Object.keys(result.components.parameters ?? {})).toEqual([
    "path.id",
    "path.id.Item.ID",
  ])
  expect(result.paths?.["/items"]?.get?.parameters).toEqual([
    {
      name: "cursor",
      in: "query",
      schema: { anyOf: [{ type: "string" }, { type: "null" }] },
      required: false,
    },
  ])
  expect(result.paths?.["/items/{id}"]?.get?.parameters).toEqual([
    { $ref: "#/components/parameters/path.id.Item.ID" },
  ])
  expect(result.paths?.["/raw/{id}"]?.get?.parameters).toEqual([
    { $ref: "#/components/parameters/path.id" },
  ])
})

test("adding an unrelated endpoint with a limit query param does not rename existing parameter components", () => {
  const baseGroup = HttpApiGroup.make("items")
    .add(
      HttpApiEndpoint.get("listA", "/a", {
        query: { limit: Schema.optional(Schema.NumberFromString) },
      }),
    )
    .add(
      HttpApiEndpoint.get("listB", "/b", {
        query: { limit: Schema.optional(Schema.NumberFromString) },
      }),
    )

  const before = stabilizeOpenApi(OpenApi.fromApi(HttpApi.make("test").add(baseGroup)))
  const after = stabilizeOpenApi(
    OpenApi.fromApi(
      HttpApi.make("test").add(
        baseGroup.add(
          HttpApiEndpoint.get("unrelated", "/unrelated", {
            query: {
              limit: Schema.optional(Schema.NumberFromString).annotate({
                description: "Unrelated endpoint limit",
              }),
            },
          }),
        ),
      ),
    ),
  )

  expect(before.components.parameters).toBeDefined()
  expect(after.components.parameters).toEqual(before.components.parameters)
})

test("stabilized ClientApi OpenAPI document is semantically identical after dereferencing $refs", () => {
  const raw = OpenApi.fromApi(ClientApi)
  const stabilized = stabilizeOpenApi(structuredClone(raw))

  const dereference = (spec: {
    components?: {
      schemas?: Record<string, unknown>
      parameters?: Record<string, unknown>
    }
    paths?: unknown
  }) => {
    const schemas = spec.components?.schemas ?? {}
    const parameters = spec.components?.parameters ?? {}
    const visit = (node: unknown, seen = new Set<string>()): unknown => {
      if (Array.isArray(node)) return node.map((item) => visit(item, seen))
      if (typeof node !== "object" || node === null) return node
      const ref = "$ref" in node && typeof node.$ref === "string" ? node.$ref : undefined
      if (ref) {
        if (seen.has(ref)) throw new Error(`Cycle while dereferencing ${ref}`)
        const next = new Set([...seen, ref])
        const target = ref.startsWith("#/components/parameters/")
          ? parameters[ref.slice("#/components/parameters/".length)]
          : ref.startsWith("#/components/schemas/")
            ? schemas[ref.slice("#/components/schemas/".length)]
            : undefined
        if (target === undefined) throw new Error(`Unresolved OpenAPI $ref: ${ref}`)
        const resolved = visit(target, next)
        const siblings = Object.entries(node).filter(([key]) => key !== "$ref")
        if (siblings.length === 0 || typeof resolved !== "object" || resolved === null || Array.isArray(resolved)) {
          return resolved
        }
        return Object.fromEntries(
          Object.entries({
            ...resolved,
            ...Object.fromEntries(siblings.map(([key, value]) => [key, visit(value, seen)])),
          }).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
        )
      }
      return Object.fromEntries(
        Object.entries(node)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, value]) => [key, visit(value, seen)]),
      )
    }
    return visit(spec.paths)
  }

  expect(dereference(stabilized)).toEqual(dereference(raw))
})
