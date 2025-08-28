import { describe, expect, test } from "bun:test"

// Direct test of truncation logic without full app context
describe("bash truncation logic", () => {
  test("truncates from head to tail", () => {
    const MAX_OUTPUT_LENGTH = 30_000
    let output = "START" + "x".repeat(35_000) + "END"

    if (output.length > MAX_OUTPUT_LENGTH) {
      const truncated = output.slice(output.length - MAX_OUTPUT_LENGTH)
      output = "(Output was truncated due to length limit)\n\n" + truncated
    }

    expect(output.startsWith("(Output was truncated due to length limit)\n\n")).toBe(true)
    expect(output.includes("START")).toBe(false)
    expect(output.endsWith("END")).toBe(true)
    expect(output.length).toBeLessThanOrEqual(30_000 + 49) // limit + header length
  })
})
