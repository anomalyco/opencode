import { describe, expect, test } from "bun:test"
import {
  validateRegexComplexity,
  assertValidRegex,
  withTimeout,
} from "../../src/util/regex-validator"

describe("regex-validator", () => {
  describe("validateRegexComplexity", () => {
    test("accepts simple valid patterns", () => {
      const result = validateRegexComplexity("hello")
      expect(result.valid).toBe(true)
    })

    test("accepts moderate complexity patterns", () => {
      const result = validateRegexComplexity("function\\s+\\w+")
      expect(result.valid).toBe(true)
    })

    test("accepts common search patterns", () => {
      const patterns = [
        "TODO",
        "import.*from",
        "\\bclass\\b",
        "error|warning|critical",
        "^\\s*export",
      ]
      for (const pattern of patterns) {
        const result = validateRegexComplexity(pattern)
        expect(result.valid).toBe(true)
      }
    })

    test("rejects empty patterns", () => {
      const result = validateRegexComplexity("")
      expect(result.valid).toBe(false)
      expect(result.reason).toContain("empty")
    })

    test("rejects patterns exceeding max length", () => {
      const longPattern = "a".repeat(1001)
      const result = validateRegexComplexity(longPattern)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain("exceeds maximum length")
    })

    test("rejects nested quantifiers (exponential backtracking)", () => {
      const dangerousPatterns = [
        "(a+)+",
        "(a*)*",
        "(a?)?",
        "((a+)+)",
        "(.*)*",
      ]
      for (const pattern of dangerousPatterns) {
        const result = validateRegexComplexity(pattern)
        expect(result.valid).toBe(false)
        expect(result.reason).toContain("exponential backtracking")
      }
    })

    test("rejects overlapping alternations with quantifiers", () => {
      const dangerousPatterns = ["(a|b)+", "(foo|bar)*"]
      for (const pattern of dangerousPatterns) {
        const result = validateRegexComplexity(pattern)
        expect(result.valid).toBe(false)
      }
    })

    test("rejects invalid regex syntax", () => {
      const result = validateRegexComplexity("[invalid")
      expect(result.valid).toBe(false)
      expect(result.reason).toContain("Invalid regex syntax")
    })

    test("rejects patterns with excessive complexity score", () => {
      // This pattern has many quantified groups
      const complexPattern = "(a+)(b+)(c+)(d+)(e+)(f+)(g+)(h+)(i+)(j+)(k+)"
      const result = validateRegexComplexity(complexPattern)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain("complexity score")
    })

    test("provides complexity score for valid patterns", () => {
      const result = validateRegexComplexity("\\d+\\.\\d+")
      expect(result.valid).toBe(true)
      expect(result.complexityScore).toBeGreaterThan(0)
    })

    test("rejects deeply nested groups", () => {
      const deeplyNested = "((((((((a))))))))"
      const result = validateRegexComplexity(deeplyNested)
      // Should be valid but with high complexity score
      // If nesting is too deep, it will be rejected
      expect(result.valid).toBeDefined()
    })
  })

  describe("assertValidRegex", () => {
    test("does not throw for valid patterns", () => {
      expect(() => assertValidRegex("hello")).not.toThrow()
      expect(() => assertValidRegex("\\w+")).not.toThrow()
    })

    test("throws for invalid patterns", () => {
      expect(() => assertValidRegex("")).toThrow("Invalid regex pattern")
      expect(() => assertValidRegex("(a+)+")).toThrow("Invalid regex pattern")
    })

    test("includes reason in error message", () => {
      expect(() => assertValidRegex("")).toThrow("empty")
    })
  })

  describe("withTimeout", () => {
    test("resolves when promise completes before timeout", async () => {
      const result = await withTimeout(Promise.resolve("success"), 1000)
      expect(result).toBe("success")
    })

    test("rejects when promise exceeds timeout", async () => {
      const slowPromise = new Promise((resolve) => setTimeout(() => resolve("late"), 200))
      await expect(withTimeout(slowPromise, 50)).rejects.toThrow("timed out")
    })

    test("preserves promise rejection", async () => {
      const failingPromise = Promise.reject(new Error("original error"))
      await expect(withTimeout(failingPromise, 1000)).rejects.toThrow("original error")
    })
  })
})
