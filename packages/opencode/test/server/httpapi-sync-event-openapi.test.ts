import { describe, expect, test } from "bun:test"
import { OpenApi } from "effect/unstable/httpapi"
import { PublicApi } from "../../src/server/routes/instance/httpapi/public"
import { SyncEvent } from "../../src/sync"

type OpenApiSpec = {
  components?: {
    schemas?: Record<string, Record<string, unknown>>
  }
}

describe("SyncEvent OpenAPI spec matches server output", () => {
  const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec
  const schemas = spec.components?.schemas ?? {}

  test("sync event schemas use 'type' as string field (not literal 'sync')", () => {
    for (const [name, schema] of Object.entries(schemas)) {
      if (!name.startsWith("SyncEvent.")) continue
      const props = schema.properties as Record<string, unknown> | undefined
      expect(props?.type, `${name} should have 'type' field`).toBeDefined()
      const typeField = props?.type as Record<string, unknown> | undefined
      expect(
        typeField?.const !== "sync",
        `${name} type should NOT be a constant 'sync' — that makes it indistinguishable in unions`,
      ).toBe(true)
    }
  })

  test("sync event schemas do NOT have 'name' field", () => {
    for (const [name, schema] of Object.entries(schemas)) {
      if (!name.startsWith("SyncEvent.")) continue
      const props = schema.properties as Record<string, unknown> | undefined
      expect(props?.name, `${name} should NOT have 'name' field`).toBeUndefined()
    }
  })

  test("aggregateID is a string field (not constant enum)", () => {
    for (const [name, schema] of Object.entries(schemas)) {
      if (!name.startsWith("SyncEvent.")) continue
      const props = schema.properties as Record<string, unknown> | undefined
      const aggId = props?.aggregateID as Record<string, unknown> | undefined
      expect(aggId?.enum, `${name} aggregateID should not be a constant enum`).toBeUndefined()
      expect(aggId?.type).toBe("string")
    }
  })

  test("GlobalEvent payload union includes SyncEvent schemas directly", () => {
    const globalEvent = schemas["GlobalEvent"]
    expect(globalEvent).toBeDefined()
    const payload = globalEvent?.properties?.payload as Record<string, unknown> | undefined
    const anyOf = (payload?.anyOf ?? payload?.oneOf) as Record<string, unknown>[] | undefined
    expect(anyOf).toBeDefined()
    // At least one SyncEvent schema should be in the union
    const hasSyncSchema = anyOf?.some(
      (s: Record<string, unknown>) =>
        (s.$ref as string | undefined)?.includes("SyncEvent"),
    )
    expect(hasSyncSchema, "GlobalEvent.payload should include SyncEvent schemas").toBe(true)
  })

  test("effectPayloads returns schemas with dynamic type field", () => {
    const payloads = SyncEvent.effectPayloads()
    expect(payloads.length).toBeGreaterThan(0)
    // Each schema's AST may be wrapped; find the TypeLiteral and check 'type' property
    for (const schema of payloads) {
      let typePs = schema.ast.propertySignatures?.find((ps) => ps.name === "type")
      // If it's a Union/Objects wrapper, check inner types
      if (!typePs && schema.ast.types) {
        for (const inner of schema.ast.types) {
          typePs = inner.propertySignatures?.find((ps) => ps.name === "type")
          if (typePs) break
        }
      }
      expect(typePs, "schema should have 'type' property").toBeDefined()
      // type should be a string schema, not a literal
      expect(typePs!.type._tag).toBe("String")
    }
  })

  test("effectPayloads schemas have aggregateID as string, not literal", () => {
    const payloads = SyncEvent.effectPayloads()
    for (const schema of payloads) {
      const aggProperty = schema.ast.propertySignatures.find((ps) => ps.name === "aggregateID")
      expect(aggProperty).toBeDefined()
      expect(aggProperty!.type._tag).toBe("String")
    }
  })

  test("effectPayloads schemas do NOT have name field", () => {
    const payloads = SyncEvent.effectPayloads()
    for (const schema of payloads) {
      const nameProperty = schema.ast.propertySignatures.find((ps) => ps.name === "name")
      expect(nameProperty, `schema ${schema.ast.annotations?.identifier ?? "unknown"} should not have 'name' field`).toBeUndefined()
    }
  })
})
