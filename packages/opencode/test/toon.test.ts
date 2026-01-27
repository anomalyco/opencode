import { describe, test, expect } from "bun:test"
import { TOON } from "../src/format/toon"

describe("TOON Serialization", () => {
  describe("Compact Mode", () => {
    test("removes articles (a, an, the)", () => {
      const input = "Create a function that returns the value"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
      
      expect(output).not.toContain(" a ")
      expect(output).not.toContain(" the ")
      expect(output.length).toBeLessThan(input.length)
    })

    test("abbreviates common technical terms", () => {
      const input = "The function takes a parameter and returns a variable"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
      
      expect(output).toContain("fn")
      expect(output).toContain("param")
      expect(output).toContain("var")
      expect(output).toContain("ret")
    })

    test("abbreviates application-related terms", () => {
      const input = "Configure the application database and repository"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
      
      expect(output).toContain("app")
      expect(output).toContain("db")
      expect(output).toContain("repo")
    })

    test("compacts whitespace", () => {
      const input = "This  has    multiple     spaces"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
      
      expect(output).not.toContain("  ")
      expect(output).toBe(output.trim())
    })
  })

  describe("Balanced Mode", () => {
    test("preserves readability while reducing tokens", () => {
      const input = "The function parameter should be a string configuration"
      const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })
      
      expect(output).toContain("fn")
      expect(output).toContain("param")
      expect(output).toContain("config")
      expect(output.length).toBeLessThan(input.length)
    })

    test("normalizes whitespace", () => {
      const input = "Text   with    irregular     spacing"
      const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })
      
      expect(output).not.toContain("  ")
      expect(output).toBe(output.trim())
    })

    test("maintains sentence structure", () => {
      const input = "Create a function that processes the database configuration"
      const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })
      
      // Should still be readable
      expect(output).toContain("Create")
      expect(output).toContain("fn")
      expect(output).toContain("processes")
      expect(output).toContain("db")
      expect(output).toContain("config")
    })
  })

  describe("Verbose Mode", () => {
    test("only normalizes whitespace", () => {
      const input = "This  is   a    test    message"
      const output = TOON.serialize(input, { mode: "verbose", preserveCode: true })
      
      expect(output).not.toContain("  ")
      expect(output).toBe(output.trim())
      // Should not abbreviate
      expect(output).toContain("This is a test message")
    })

    test("preserves original text content", () => {
      const input = "Create a function with parameters"
      const output = TOON.serialize(input, { mode: "verbose", preserveCode: true })
      
      expect(output).toContain("function")
      expect(output).toContain("parameters")
      expect(output).not.toContain("fn")
      // Check that "param" doesn't appear as a standalone word (it's part of "parameters")
      expect(output).toBe("Create a function with parameters")
    })
  })

  describe("Code Preservation", () => {
    test("preserves code blocks in compact mode", () => {
      const input = `Here is a function:
\`\`\`typescript
function test() {
  return "hello"
}
\`\`\`
Please refactor it.`
      
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
      
      expect(output).toContain("```typescript")
      expect(output).toContain("function test()")
      expect(output).toContain('return "hello"')
      expect(output).toContain("```")
    })

    test("transforms text around code blocks", () => {
      const input = `Create a function like this:
\`\`\`javascript
function example() {}
\`\`\`
The function should return a value.`
      
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
      
      // Code block preserved
      expect(output).toContain("```javascript")
      expect(output).toContain("function example()")
      
      // Surrounding text transformed
      expect(output).toContain("fn")
      expect(output).toContain("ret")
    })

    test("handles multiple code blocks", () => {
      const input = `First function:
\`\`\`ts
function a() {}
\`\`\`
Second function:
\`\`\`ts
function b() {}
\`\`\`
Both functions are important.`
      
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
      
      expect(output).toContain("function a()")
      expect(output).toContain("function b()")
      expect(output).toContain("```ts")
    })

    test("transforms code when preserve is false", () => {
      const input = `\`\`\`typescript
function test() {}
\`\`\``
      
      const output = TOON.serialize(input, { mode: "compact", preserveCode: false })
      
      // Code should be transformed
      expect(output).toContain("fn")
    })
  })

  describe("Token Estimation", () => {
    test("estimates token savings correctly", () => {
      const original = "This is a test message with many words"
      const transformed = "test message many words"
      const savings = TOON.estimateSavings(original, transformed)
      
      expect(savings).toBeGreaterThan(0)
      expect(savings).toBe(Math.ceil(original.length / 4) - Math.ceil(transformed.length / 4))
    })

    test("returns zero savings for identical strings", () => {
      const text = "unchanged text"
      const savings = TOON.estimateSavings(text, text)
      
      expect(savings).toBe(0)
    })

    test("calculates percentage correctly", () => {
      const original = "Create a function that returns the value"
      const transformed = TOON.serialize(original, { mode: "compact", preserveCode: true })
      const percentage = TOON.calculateSavingsPercentage(original, transformed)
      
      expect(percentage).toBeGreaterThan(0)
      expect(percentage).toBeLessThanOrEqual(100)
    })
  })

  describe("Edge Cases", () => {
    test("handles empty strings", () => {
      const output = TOON.serialize("", { mode: "balanced", preserveCode: true })
      expect(output).toBe("")
    })

    test("handles strings with only whitespace", () => {
      const output = TOON.serialize("   \n  \t  ", { mode: "balanced", preserveCode: true })
      expect(output).toBe("")
    })

    test("handles strings without transformable content", () => {
      const input = "xyz abc def"
      const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })
      
      // Should only normalize whitespace
      expect(output).toBe("xyz abc def")
    })

    test("handles mixed case correctly", () => {
      const input = "The FUNCTION takes a PARAMETER"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
      
      expect(output).toContain("fn")
      expect(output).toContain("param")
    })
  })

  describe("Real-World Examples", () => {
    test("example 1: basic function request", () => {
      const input = "Create a function that takes a parameter called 'items' and returns the total value"
      const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })
      
      expect(output.length).toBeLessThan(input.length)
      expect(output).toContain("fn")
      expect(output).toContain("param")
      
      const savings = TOON.estimateSavings(input, output)
      expect(savings).toBeGreaterThan(0)
    })

    test("example 2: configuration request", () => {
      const input = "I need to configure the application to use a different database connection string"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
      
      expect(output).toContain("config")
      expect(output).toContain("app")
      expect(output).toContain("db")
      
      const percentage = TOON.calculateSavingsPercentage(input, output)
      expect(percentage).toBeGreaterThan(15) // Should save at least 15%
    })

    test("example 3: refactoring request with code", () => {
      const input = `Please refactor the following function:
\`\`\`typescript
function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0)
}
\`\`\`
Make sure to add proper type annotations.`
      
      const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })
      
      // Code preserved
      expect(output).toContain("function calculateTotal")
      expect(output).toContain("reduce")
      
      // Text transformed
      expect(output).toContain("fn")
      
      const savings = TOON.estimateSavings(input, output)
      expect(savings).toBeGreaterThan(0)
    })
  })
})
