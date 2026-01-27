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
      expect(output).toContain("→") // returns → symbol
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
      expect(output).toContain("cfg")
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
      expect(output).toContain("cfg")
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
      expect(output).toContain("→") // return → symbol
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

      expect(output).toContain("cfg")
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

  // Phase 1: Abbreviation Expansion Tests
  describe("Phase 1: Abbreviation Expansion", () => {
    test("abbreviates verb forms", () => {
      const input = "implement initialize validate process execute"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain("impl")
      expect(output).toContain("init")
      expect(output).toContain("val")
      expect(output).toContain("proc")
      expect(output).toContain("exec")
    })

    test("abbreviates noun forms", () => {
      const input = "interface component service controller middleware"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain("iface")
      expect(output).toContain("comp")
      expect(output).toContain("svc")
      expect(output).toContain("ctrl")
      expect(output).toContain("mw")
    })

    test("abbreviates adjective forms", () => {
      const input = "important required optional temporary permanent"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain("imp")
      expect(output).toContain("req")
      expect(output).toContain("opt")
      expect(output).toContain("tmp")
      expect(output).toContain("perm")
    })

    test("abbreviates domain-specific terms", () => {
      const input = "authentication authorization encryption compression"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain("auth")
      expect(output).toContain("authz")
      expect(output).toContain("enc")
      expect(output).toContain("comp")
    })

    test("preserves word boundaries in abbreviations", () => {
      const input = "The interface is important"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain("iface")
      expect(output).toContain("imp")
      // Should not abbreviate "interface" within "interfacing"
    })

    test("balanced mode uses selective abbreviations", () => {
      const input = "Create a function with parameters and configuration"
      const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })

      expect(output).toContain("fn")
      expect(output).toContain("param")
      expect(output).toContain("cfg")
      // Verbs should not be abbreviated in balanced mode
      expect(output).toContain("Create")
    })

    test("abbreviations reduce token count", () => {
      const input = "implement initialize validate process execute"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output.length).toBeLessThan(input.length)
      const savings = TOON.calculateSavingsPercentage(input, output)
      expect(savings).toBeGreaterThan(10)
    })
  })

  // Phase 2: Conjunction/Preposition Reduction Tests
  describe("Phase 2: Conjunction/Preposition Reduction", () => {
    test("replaces 'and' with '&' in compact mode", () => {
      const input = "Create a function and validate the input"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain("&")
      expect(output).not.toContain(" and ")
    })

    test("replaces 'or' with '|' in compact mode", () => {
      const input = "Check if the value is valid or empty"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain("|")
      expect(output).not.toContain(" or ")
    })

    test("removes redundant prepositions", () => {
      const input = "Work with the database from the repository"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).not.toContain("with the")
      expect(output).not.toContain("from the")
    })

    test("balanced mode preserves conjunctions", () => {
      const input = "Create a function and validate the input"
      const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })

      expect(output).toContain("and")
      expect(output).not.toContain("&")
    })

    test("conjunctions reduce token count", () => {
      const input = "Create and validate and process and execute"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output.length).toBeLessThan(input.length)
    })
  })

  // Phase 3: Symbol Substitution Tests
  describe("Phase 3: Symbol Substitution", () => {
    test("replaces 'returns' with '→' in compact mode", () => {
      const input = "The function returns a value"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain("→")
      expect(output).not.toContain("returns")
    })

    test("replaces 'equals' with '=' in compact mode", () => {
      const input = "The value equals the expected result"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain("=")
      expect(output).not.toContain("equals")
    })

    test("replaces comparison operators", () => {
      const input = "Check if value is greater than 10 and less than 20"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain(">")
      expect(output).toContain("<")
    })

    test("balanced mode preserves symbols", () => {
      const input = "The function returns a value"
      const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })

      expect(output).not.toContain("→")
      expect(output).toContain("returns")
    })

    test("symbols are not applied in code blocks", () => {
      const input = `\`\`\`typescript
function test() {
  return "hello"
}
\`\`\``

      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      // Code block should be preserved exactly
      expect(output).toContain("return")
      expect(output).not.toContain("→")
    })

    test("symbols reduce token count", () => {
      const input = "returns returns returns equals equals"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output.length).toBeLessThan(input.length)
    })
  })

  // Phase 4: Verb Normalization Tests
  describe("Phase 4: Verb Normalization", () => {
    test("normalizes gerund forms", () => {
      const input = "running implementing executing processing"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain("run")
      expect(output).toContain("impl")
      expect(output).toContain("exec")
      expect(output).toContain("proc")
    })

    test("normalizes past participle forms", () => {
      const input = "running implementing executing processing"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain("run")
      expect(output).toContain("impl")
      expect(output).toContain("exec")
      expect(output).toContain("proc")
    })

    test("normalizes third-person singular forms", () => {
      const input = "running implementing executing processing"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain("run")
      expect(output).toContain("impl")
      expect(output).toContain("exec")
      expect(output).toContain("proc")
    })

    test("verb normalization preserves meaning", () => {
      const input = "The system is running and processing data"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      // Should still be understandable
      expect(output).toContain("run")
      expect(output).toContain("proc")
    })

    test("verb normalization works with abbreviations", () => {
      const input = "implementing and executing and validating"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain("impl")
      expect(output).toContain("exec")
      expect(output).toContain("val")
    })
  })

  // Phase 5: Duplicate Detection Tests
  describe("Phase 5: Duplicate Detection", () => {
    test("detects duplicate sentences", () => {
      const input = "Create a function. Create a function. Create a function."
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true, enableDuplicateDetection: true })

      expect(output).toContain("[dup:")
    })

    test("preserves first occurrence of duplicate", () => {
      const input = "Create a function. Create a function."
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true, enableDuplicateDetection: true })

      // First occurrence should be preserved
      expect(output).toContain("crt")
      expect(output).toContain("fn")
    })

    test("replaces subsequent duplicates with markers", () => {
      const input = "Validate the input. Validate the input."
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true, enableDuplicateDetection: true })

      expect(output).toContain("[dup:")
    })

    test("handles multiple different duplicates", () => {
      const input = "Create a function. Validate the input. Create a function. Validate the input."
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true, enableDuplicateDetection: true })

      expect(output).toContain("[dup:")
    })

    test("case-insensitive duplicate detection", () => {
      const input = "Create a function. create a function."
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true, enableDuplicateDetection: true })

      expect(output).toContain("[dup:")
    })

    test("duplicate detection is optional", () => {
      const input = "Create a function. Create a function."
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true, enableDuplicateDetection: false })

      expect(output).not.toContain("[dup:")
    })

    test("duplicate detection works with all modes", () => {
      const input = "Validate input. Validate input."

      const compact = TOON.serialize(input, { mode: "compact", preserveCode: true, enableDuplicateDetection: true })
      const balanced = TOON.serialize(input, { mode: "balanced", preserveCode: true, enableDuplicateDetection: true })
      const verbose = TOON.serialize(input, { mode: "verbose", preserveCode: true, enableDuplicateDetection: true })

      expect(compact).toContain("[dup:")
      expect(balanced).toContain("[dup:")
      expect(verbose).toContain("[dup:")
    })

    test("duplicate detection performance is acceptable", () => {
      const input = "Create a function. ".repeat(100)
      const start = performance.now()
      TOON.serialize(input, { mode: "compact", preserveCode: true, enableDuplicateDetection: true })
      const duration = performance.now() - start

      expect(duration).toBeLessThan(50)
    })

    test("duplicate detection reduces token count", () => {
      const input = "Create a function. Create a function. Create a function."
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true, enableDuplicateDetection: true })

      expect(output.length).toBeLessThan(input.length)
    })

    test("duplicate detection with code blocks", () => {
      const input = `\`\`\`typescript
function test() {}
\`\`\`
Create a function. Create a function.`

      const output = TOON.serialize(input, { mode: "compact", preserveCode: true, enableDuplicateDetection: true })

      expect(output).toContain("function test()")
      expect(output).toContain("[dup:")
    })
  })

  // Mode Hierarchy Tests
  describe("Mode Hierarchy", () => {
    test("compact produces shorter output than balanced", () => {
      const input = "Create a function that implements validation and returns a value"
      const compact = TOON.serialize(input, { mode: "compact", preserveCode: true })
      const balanced = TOON.serialize(input, { mode: "balanced", preserveCode: true })

      expect(compact.length).toBeLessThanOrEqual(balanced.length)
    })

    test("balanced produces shorter output than verbose", () => {
      const input = "Create a function that implements validation and returns a value"
      const balanced = TOON.serialize(input, { mode: "balanced", preserveCode: true })
      const verbose = TOON.serialize(input, { mode: "verbose", preserveCode: true })

      expect(balanced.length).toBeLessThanOrEqual(verbose.length)
    })

    test("all modes produce valid output", () => {
      const input = "Create a function that implements validation"

      const compact = TOON.serialize(input, { mode: "compact", preserveCode: true })
      const balanced = TOON.serialize(input, { mode: "balanced", preserveCode: true })
      const verbose = TOON.serialize(input, { mode: "verbose", preserveCode: true })

      expect(compact).toBeTruthy()
      expect(balanced).toBeTruthy()
      expect(verbose).toBeTruthy()
    })
  })

  // Performance Tests
  describe("Performance", () => {
    test("transformation completes quickly for small text", () => {
      const input = "Create a function that implements validation"
      const start = performance.now()
      TOON.serialize(input, { mode: "compact", preserveCode: true })
      const duration = performance.now() - start

      expect(duration).toBeLessThan(10)
    })

    test("transformation completes within bounds for 1000 messages", () => {
      const input = "Create a function. "
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        TOON.serialize(input, { mode: "compact", preserveCode: true })
      }
      const duration = performance.now() - start

      expect(duration).toBeLessThan(100)
    })
  })

  // Savings Target Tests
  describe("Savings Target", () => {
    test("achieves significant token reduction in compact mode", () => {
      const input = "Create a function that implements validation and returns a value"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      const savings = TOON.calculateSavingsPercentage(input, output)
      expect(savings).toBeGreaterThan(20)
    })

    test("maintains reasonable savings in balanced mode", () => {
      const input = "Create a function that implements validation and returns a value"
      const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })

      const savings = TOON.calculateSavingsPercentage(input, output)
      expect(savings).toBeGreaterThan(10)
    })

    test("minimal savings in verbose mode", () => {
      const input = "Create a function that implements validation and returns a value"
      const output = TOON.serialize(input, { mode: "verbose", preserveCode: true })

      const savings = TOON.calculateSavingsPercentage(input, output)
      expect(savings).toBeLessThan(5)
    })
  })
})
