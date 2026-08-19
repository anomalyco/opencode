import { describe, expect, test } from "bun:test"
import { validateToolCall, validationRetryMessage, type ToolSchemaDef } from "@/vantacode/tool-validate"

const editTool: ToolSchemaDef = {
  name: "edit",
  description: "Edit a file",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
      max_matches: { type: "integer" },
    },
    required: ["file_path", "old_string", "new_string"],
  },
}

const tools = [editTool]

describe("validateToolCall", () => {
  test("accepts a well-formed call", () => {
    const result = validateToolCall(
      { name: "edit", arguments: { file_path: "a.ts", old_string: "x", new_string: "y" } },
      tools,
    )
    expect(result.ok).toBe(true)
  })

  test("rejects unknown tool", () => {
    const result = validateToolCall({ name: "delete_everything", arguments: {} }, tools)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("unknown_tool")
  })

  test("rejects missing required args", () => {
    const result = validateToolCall({ name: "edit", arguments: { file_path: "a.ts" } }, tools)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("missing_required")
  })

  test("rejects wrong type", () => {
    const result = validateToolCall(
      { name: "edit", arguments: { file_path: 123, old_string: "x", new_string: "y" } },
      tools,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("wrong_type")
  })

  test("rejects float where integer required", () => {
    const result = validateToolCall(
      { name: "edit", arguments: { file_path: "a.ts", old_string: "x", new_string: "y", max_matches: 2.5 } },
      tools,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("wrong_type")
  })

  test("accepts integer for integer field", () => {
    const result = validateToolCall(
      { name: "edit", arguments: { file_path: "a.ts", old_string: "x", new_string: "y", max_matches: 2 } },
      tools,
    )
    expect(result.ok).toBe(true)
  })

  test("tolerates extra undefined-in-schema properties", () => {
    const result = validateToolCall(
      { name: "edit", arguments: { file_path: "a.ts", old_string: "x", new_string: "y", extra: true } },
      tools,
    )
    expect(result.ok).toBe(true)
  })

  test("validationRetryMessage produces a corrective string", () => {
    const result = validateToolCall({ name: "nope", arguments: {} }, tools)
    if (!result.ok) {
      const msg = validationRetryMessage(result)
      expect(msg).toContain("Tool call rejected")
    }
  })
})
