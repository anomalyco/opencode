import { describe, expect, test } from "bun:test"
import { Truncate } from "../../src/tool/truncation"

describe("tool.truncation", () => {
  test("handles string input", async () => {
    const result = await Truncate.output("hello world")
    expect(result.truncated).toBe(false)
    expect(result.content).toBe("hello world")
  })

  test("truncates output exceeding max lines", async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`)
    const result = await Truncate.output(lines.join("\n"), { maxLines: 10 })
    expect(result.truncated).toBe(true)
    expect(result.content).toContain("line 0")
    expect(result.content).toContain("truncated")
  })
})
