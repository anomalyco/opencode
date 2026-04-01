import { describe, test, expect } from "bun:test"
import { TOON } from "../src/format/toon"

describe("TOON Regression Tests", () => {
  describe("Known Issues Prevention", () => {
    test("doesn't remove articles from code identifiers", () => {
      const text = `Here is the code:
\`\`\`typescript
const theValue = 42
const aFunction = () => {}
\`\`\`
Use the variables.`

      const result = TOON.serialize(text, { mode: "compact", preserveCode: true })

      // Code should be preserved with original identifiers
      expect(result).toContain("theValue")
      expect(result).toContain("aFunction")
    })

    test("handles consecutive whitespace correctly", () => {
      const text = "Create    a     function      with       parameters"
      const result = TOON.serialize(text, { mode: "balanced", preserveCode: true })

      // Should normalize to single spaces
      expect(result).not.toContain("  ")
      expect(result).toBe(result.trim())
    })

    test("preserves markdown formatting outside code blocks", () => {
      const text = `# Create a Function
      
**Important**: The function should have parameters.

- First parameter
- Second parameter`

      const result = TOON.serialize(text, { mode: "balanced", preserveCode: true })

      // Should preserve markdown structure
      expect(result).toContain("#")
      expect(result).toContain("**")
      expect(result).toContain("-")
    })

    test("doesn't break on malformed code blocks", () => {
      const text = "Here is code: ```typescript\nfunction test()\nMissing closing marker"

      expect(() => {
        TOON.serialize(text, { mode: "balanced", preserveCode: true })
      }).not.toThrow()
    })

    test("handles empty code blocks", () => {
      const text = "Empty block:\n```\n```\nContinue text"

      const result = TOON.serialize(text, { mode: "balanced", preserveCode: true })

      expect(result).toContain("```")
    })
  })

  describe("Boundary Conditions", () => {
    test("handles text that is exactly one word", () => {
      const result = TOON.serialize("function", { mode: "compact", preserveCode: true })
      expect(result).toBe("fn")
    })

    test("handles text with only transformable words", () => {
      const text = "function parameter variable return"
      const result = TOON.serialize(text, { mode: "compact", preserveCode: true })

      expect(result).toBe("fn param var →")
    })

    test("handles text with no transformable words", () => {
      const text = "xyz abc def ghi"
      const result = TOON.serialize(text, { mode: "balanced", preserveCode: true })

      expect(result).toBe("xyz abc def ghi")
    })

    test("handles single character input", () => {
      const result = TOON.serialize("a", { mode: "compact", preserveCode: true })
      expect(result).toBe("")
    })

    test("handles newlines and tabs", () => {
      const text = "Create\na\nfunction\twith\tparameters"
      const result = TOON.serialize(text, { mode: "balanced", preserveCode: true })

      // Should normalize all whitespace
      expect(result).not.toContain("\n")
      expect(result).not.toContain("\t")
    })
  })

  describe("Transformation Accuracy", () => {
    test("compact mode: comprehensive transformation", () => {
      const text =
        "Create a function that takes a parameter, accesses the database, and returns a value from the application configuration"
      const result = TOON.serialize(text, { mode: "compact", preserveCode: true })

      expect(result).toContain("fn")
      expect(result).toContain("param")
      expect(result).toContain("db")
      expect(result).toContain("→") // returns → symbol
      expect(result).toContain("app")
      expect(result).toContain("cfg")

      // Articles should be removed
      expect(result).not.toContain(" a ")
      expect(result).not.toContain(" the ")
    })

    test("balanced mode: selective transformation", () => {
      const text = "Create a function that takes a parameter and uses the configuration"
      const result = TOON.serialize(text, { mode: "balanced", preserveCode: true })

      expect(result).toContain("fn")
      expect(result).toContain("param")
      expect(result).toContain("cfg")

      // Should preserve some structure
      expect(result).toContain("Create")
      expect(result).toContain("takes")
    })

    test("verbose mode: minimal transformation", () => {
      const text = "Create a function that takes a parameter"
      const result = TOON.serialize(text, { mode: "verbose", preserveCode: true })

      // Should only normalize whitespace
      expect(result).toContain("function")
      expect(result).toContain("parameter")
      expect(result).not.toContain("fn")
      // Verify exact output to ensure no transformation happened
      expect(result).toBe("Create a function that takes a parameter")
    })
  })

  describe("Token Estimation Accuracy", () => {
    test("estimates tokens correctly for short text", () => {
      const text = "test" // 4 characters = 1 token
      const transformed = "test"

      const savings = TOON.estimateSavings(text, transformed)
      expect(savings).toBe(0)
    })

    test("estimates tokens correctly for medium text", () => {
      const text = "a".repeat(40) // 40 characters = 10 tokens
      const transformed = "a".repeat(20) // 20 characters = 5 tokens

      const savings = TOON.estimateSavings(text, transformed)
      expect(savings).toBe(5)
    })

    test("percentage calculation is accurate", () => {
      const original = "a".repeat(100) // 25 tokens
      const transformed = "a".repeat(80) // 20 tokens

      const percentage = TOON.calculateSavingsPercentage(original, transformed)
      expect(percentage).toBeCloseTo(20, 1) // 5/25 = 20%
    })

    test("handles zero-length strings in estimation", () => {
      const savings = TOON.estimateSavings("", "")
      expect(savings).toBe(0)

      const percentage = TOON.calculateSavingsPercentage("", "")
      expect(percentage).toBe(0)
    })
  })

  describe("Case Sensitivity", () => {
    test("transforms regardless of case", () => {
      const variations = ["FUNCTION", "Function", "function", "FuNcTiOn"]

      for (const text of variations) {
        const result = TOON.serialize(text, { mode: "compact", preserveCode: true })
        expect(result.toLowerCase()).toBe("fn")
      }
    })

    test("preserves case in non-transformable words", () => {
      const text = "Create IMPORTANT Data"
      const result = TOON.serialize(text, { mode: "verbose", preserveCode: true })

      expect(result).toContain("IMPORTANT")
    })
  })

  describe("Real-World Regression Cases", () => {
    test("case 1: SQL query in code block", () => {
      const text = `Execute this query:
\`\`\`sql
SELECT * FROM users WHERE id = 1
\`\`\`
The query returns a value.`

      const result = TOON.serialize(text, { mode: "balanced", preserveCode: true })

      expect(result).toContain("SELECT * FROM users WHERE id = 1")
      expect(result).toContain("returns")
    })

    test("case 2: JSON configuration", () => {
      const text = `Update the configuration:
\`\`\`json
{
  "database": "production",
  "port": 5432
}
\`\`\`
Apply the configuration to the application.`

      const result = TOON.serialize(text, { mode: "balanced", preserveCode: true })

      expect(result).toContain('"database"')
      expect(result).toContain('"port"')
      expect(result).toContain("cfg")
      expect(result).toContain("app")
    })

    test("case 3: Multiple languages in one message", () => {
      const text = `First, the TypeScript:
\`\`\`typescript
function test() {}
\`\`\`
Then the Python:
\`\`\`python
def test():
    pass
\`\`\`
Both functions should work.`

      const result = TOON.serialize(text, { mode: "balanced", preserveCode: true })

      // Code blocks should be preserved exactly
      expect(result).toContain("function test()")
      expect(result).toContain("def test():")
      // In balanced mode, "function" inside code blocks is preserved
      // The word "functions" (plural) is not transformed by TOON
      expect(result).toContain("functions")
    })
  })
})
