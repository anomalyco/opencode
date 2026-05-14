import { describe, expect, test } from "bun:test"
import { normalizeMcpInputSchema } from "../../src/mcp"

describe("MCP tool schemas", () => {
  test("preserves open-ended object arrays", () => {
    const schema = normalizeMcpInputSchema({
      type: "object",
      properties: {
        body: {
          type: "object",
          properties: {
            numberlist: { type: "array", items: { type: "number" } },
            objectdata: {
              type: "array",
              items: { type: "object", additionalProperties: true },
            },
            objectlist: {
              type: "array",
              items: { type: "object", additionalProperties: true },
            },
            text: { type: "string" },
          },
          required: ["objectdata", "objectlist", "text", "numberlist"],
        },
      },
      required: ["body"],
    })

    expect(schema).toMatchObject({
      properties: {
        body: {
          properties: {
            objectdata: {
              items: {
                type: "object",
                additionalProperties: true,
                properties: {},
              },
            },
            objectlist: {
              items: {
                type: "object",
                additionalProperties: true,
                properties: {},
              },
            },
          },
          required: ["objectdata", "objectlist", "text", "numberlist"],
        },
      },
    })
  })

  test("preserves nested map fields in object arrays", () => {
    const schema = normalizeMcpInputSchema({
      type: "object",
      properties: {
        records: {
          type: ["null", "array"],
          items: {
            type: "object",
            properties: {
              record_id: { type: "string" },
              value: { type: "object", additionalProperties: true },
            },
            required: ["record_id", "value"],
            additionalProperties: false,
          },
        },
      },
    })

    expect(schema).toMatchObject({
      properties: {
        records: {
          items: {
            properties: {
              value: {
                type: "object",
                additionalProperties: true,
                properties: {},
              },
            },
            required: ["record_id", "value"],
          },
        },
      },
    })
  })
})
