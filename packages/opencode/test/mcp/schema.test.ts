import { describe, expect, test } from "bun:test"
import { stripUnknownFormats } from "../../src/mcp/schema"

describe("mcp.schema", () => {
  test("removes unknown formats and preserves standard ones", () => {
    const schema = {
      type: "object",
      properties: {
        a: { type: "string", format: "uint64" },
        b: { type: "string", format: "date-time" },
        c: {
          anyOf: [
            { type: "string", format: "path" },
            { type: "string", format: "email" },
          ],
        },
      },
    }

    const out = stripUnknownFormats(schema) as Record<string, unknown>
    const properties = out.properties as Record<string, unknown>
    const a = properties.a as Record<string, unknown>
    const b = properties.b as Record<string, unknown>
    const c = properties.c as Record<string, unknown>
    const anyOf = c.anyOf as Array<Record<string, unknown>>

    expect(a.format).toBeUndefined()
    expect(b.format).toBe("date-time")
    expect(anyOf[0]?.format).toBeUndefined()
    expect(anyOf[1]?.format).toBe("email")
  })

  test("preserves boolean schema positions and sanitizes nested $defs formats", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      $defs: {
        nested: {
          type: "object",
          properties: {
            createdAt: { type: "string", format: "google-datetime" },
            id: { type: "string", format: "uuid" },
          },
        },
      },
    }

    const out = stripUnknownFormats(schema) as Record<string, unknown>
    const defs = out.$defs as Record<string, unknown>
    const nested = defs.nested as Record<string, unknown>
    const properties = nested.properties as Record<string, unknown>
    const createdAt = properties.createdAt as Record<string, unknown>
    const id = properties.id as Record<string, unknown>

    expect(out.additionalProperties).toBe(false)
    expect(createdAt.format).toBeUndefined()
    expect(id.format).toBe("uuid")
  })
})
