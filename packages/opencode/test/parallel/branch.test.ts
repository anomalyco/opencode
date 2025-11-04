import { describe, test, expect } from "bun:test"
import { Branch } from "../../src/parallel/branch"

describe("Branch", () => {
  describe("generateName", () => {
    test("should generate branch name from prompt", () => {
      const result = Branch.generateName("Add authentication feature")
      expect(result).toMatch(/^add-authentication-feature-\d+$/)
    })

    test("should truncate long prompts to 50 characters", () => {
      const longPrompt =
        "This is a very long prompt that exceeds fifty characters and should be truncated"
      const result = Branch.generateName(longPrompt)
      expect(result.length).toBeLessThan(70) // 50 chars + hyphen + timestamp
    })

    test("should replace special characters with hyphens", () => {
      const result = Branch.generateName("Add @feature #123 & test!")
      expect(result).toMatch(/^add-feature-123-test-\d+$/)
    })

    test("should remove leading and trailing hyphens", () => {
      const result = Branch.generateName("---test---")
      expect(result).toMatch(/^test-\d+$/)
    })

    test("should dedupe multiple hyphens", () => {
      const result = Branch.generateName("test---multiple---hyphens")
      expect(result).toMatch(/^test-multiple-hyphens-\d+$/)
    })

    test("should handle empty prompt", () => {
      const result = Branch.generateName("")
      expect(result).toMatch(/^opencode-\d+$/)
    })

    test("should convert to lowercase", () => {
      const result = Branch.generateName("ADD UPPERCASE FEATURE")
      expect(result).toMatch(/^add-uppercase-feature-\d+$/)
    })

    test("should include timestamp", async () => {
      const result1 = Branch.generateName("test")
      await new Promise((resolve) => setTimeout(resolve, 2)) // Ensure different timestamp
      const result2 = Branch.generateName("test")
      expect(result1).not.toBe(result2) // Different timestamps
    })
  })
})
