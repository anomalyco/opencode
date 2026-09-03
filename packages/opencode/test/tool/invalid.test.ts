import { describe, expect, test } from "bun:test"
import { formatInvalidToolError } from "../../src/tool/invalid"

describe("InvalidTool", () => {
  test("omits repeated available-tool enumerations from unavailable tool errors", () => {
    const available = Array.from({ length: 40 }, (_, index) => `expensive_tool_${index}`).join(", ")
    const output = formatInvalidToolError(
      `Model tried to call unavailable tool 'unknown'. Available tools: ${available}`,
    )

    expect(output).toContain("unknown")
    expect(output).not.toContain("Available tools:")
    expect(output.length).toBeLessThan(220)
  })
})
