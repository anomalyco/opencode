import { describe, expect, spyOn, test } from "bun:test"
import { McpSchema } from "@/mcp/schema"

describe("McpSchema.createJsonSchemaValidator", () => {
  test("ignores non-standard formats without logging", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const validate = McpSchema.createJsonSchemaValidator().getValidator({
        type: "object",
        properties: { pid: { type: "integer", format: "uint64" } },
        required: ["pid"],
      })
      expect(warn).not.toHaveBeenCalled()
      expect(validate({ pid: 7 }).valid).toBe(true)
      expect(validate({ pid: "7" }).valid).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  test("still validates known formats", () => {
    const validate = McpSchema.createJsonSchemaValidator().getValidator({
      type: "object",
      properties: { id: { type: "string", format: "uuid" } },
      required: ["id"],
    })
    expect(validate({ id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" }).valid).toBe(true)
    expect(validate({ id: "not-a-uuid" }).valid).toBe(false)
  })
})
