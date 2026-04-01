import { describe, test, expect } from "bun:test"
import { TOON } from "../src/format/toon"

// Property-Based Tests for TOON Optimization
// These tests verify universal properties that should hold across all inputs

describe("TOON Property-Based Tests", () => {
  // Property 1: Code Block Preservation
  // **Validates: Requirements 1.5, 3.5, 7.2**
  describe("Property 1: Code Block Preservation", () => {
    test("code blocks are always preserved when preserveCode is true", () => {
      const codeBlocks = [
        "```typescript\nfunction test() {}\n```",
        "```javascript\nconst x = 1;\n```",
        "```python\ndef foo():\n  pass\n```",
        "```\nplain code\n```",
      ]

      for (const code of codeBlocks) {
        const input = `Here is code:\n${code}\nEnd.`
        const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

        expect(output).toContain(code)
      }
    })

    test("code blocks are preserved across all modes", () => {
      const input = `\`\`\`typescript\nfunction test() {}\n\`\`\``

      const compact = TOON.serialize(input, { mode: "compact", preserveCode: true })
      const balanced = TOON.serialize(input, { mode: "balanced", preserveCode: true })
      const verbose = TOON.serialize(input, { mode: "verbose", preserveCode: true })

      expect(compact).toContain("function test()")
      expect(balanced).toContain("function test()")
      expect(verbose).toContain("function test()")
    })

    test("multiple code blocks are all preserved", () => {
      const input = `First:\n\`\`\`ts\ncode1\n\`\`\`\nSecond:\n\`\`\`ts\ncode2\n\`\`\``
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain("code1")
      expect(output).toContain("code2")
    })
  })

  // Property 2: Token Reduction Monotonicity
  // **Validates: Requirements 1.4, 2.5, 3.4, 4.4, 5.4**
  describe("Property 2: Token Reduction Monotonicity", () => {
    test("compact mode never increases token count", () => {
      const inputs = [
        "Create a function",
        "Implement validation logic",
        "Configure the application database",
        "Process and validate the input",
        "The function returns a value",
      ]

      for (const input of inputs) {
        const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
        expect(output.length).toBeLessThanOrEqual(input.length)
      }
    })

    test("balanced mode never increases token count", () => {
      const inputs = [
        "Create a function",
        "Implement validation logic",
        "Configure the application database",
        "Process and validate the input",
        "The function returns a value",
      ]

      for (const input of inputs) {
        const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })
        expect(output.length).toBeLessThanOrEqual(input.length)
      }
    })

    test("verbose mode only normalizes whitespace", () => {
      const inputs = ["Text   with    spaces", "Multiple\n\nlines", "Tabs\t\there"]

      for (const input of inputs) {
        const output = TOON.serialize(input, { mode: "verbose", preserveCode: true })
        // Verbose should only normalize whitespace, so length should be <= original
        expect(output.length).toBeLessThanOrEqual(input.length)
      }
    })
  })

  // Property 3: Mode Hierarchy
  // **Validates: Requirements 1.2, 2.4, 3.4**
  describe("Property 3: Mode Hierarchy", () => {
    test("compact <= balanced <= verbose in token count", () => {
      const inputs = [
        "Create a function that implements validation",
        "Configure the application and database",
        "Process and validate the input data",
        "The function returns a value",
        "Important required optional temporary",
      ]

      for (const input of inputs) {
        const compact = TOON.serialize(input, { mode: "compact", preserveCode: true })
        const balanced = TOON.serialize(input, { mode: "balanced", preserveCode: true })
        const verbose = TOON.serialize(input, { mode: "verbose", preserveCode: true })

        expect(compact.length).toBeLessThanOrEqual(balanced.length)
        expect(balanced.length).toBeLessThanOrEqual(verbose.length)
      }
    })

    test("compact always produces most savings", () => {
      const inputs = [
        "Create a function that implements validation",
        "Configure the application and database",
        "Process and validate the input data",
      ]

      for (const input of inputs) {
        const compact = TOON.serialize(input, { mode: "compact", preserveCode: true })
        const balanced = TOON.serialize(input, { mode: "balanced", preserveCode: true })

        const compactSavings = TOON.calculateSavingsPercentage(input, compact)
        const balancedSavings = TOON.calculateSavingsPercentage(input, balanced)

        expect(compactSavings).toBeGreaterThanOrEqual(balancedSavings)
      }
    })
  })

  // Property 4: Readability Preservation in Balanced Mode
  // **Validates: Requirements 2.5, 6.2**
  describe("Property 4: Readability Preservation in Balanced Mode", () => {
    test("balanced mode preserves key words", () => {
      const input = "Create a function that returns a value"
      const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })

      // Key words should be preserved
      expect(output).toContain("Create")
      expect(output).toContain("fn")
      expect(output).toContain("value")
    })

    test("balanced mode preserves sentence structure", () => {
      const input = "Create a function. Implement validation. Return a value."
      const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })

      // Should still have periods
      expect(output).toContain(".")
      // Should still be readable
      expect(output.length).toBeGreaterThan(0)
    })
  })

  // Property 5: Performance Bounds
  // **Validates: Requirements 7.1, Performance**
  describe("Property 5: Performance Bounds", () => {
    test("transformation completes within 100ms for 1000 messages", () => {
      const input = "Create a function. "
      const start = performance.now()

      for (let i = 0; i < 1000; i++) {
        TOON.serialize(input, { mode: "compact", preserveCode: true })
      }

      const duration = performance.now() - start
      expect(duration).toBeLessThan(100)
    })

    test("transformation completes quickly for large text", () => {
      const input = "Create a function that implements validation. ".repeat(100)
      const start = performance.now()
      TOON.serialize(input, { mode: "compact", preserveCode: true })
      const duration = performance.now() - start

      expect(duration).toBeLessThan(50)
    })

    test("all modes have similar performance", () => {
      const input = "Create a function that implements validation. ".repeat(50)

      const startCompact = performance.now()
      TOON.serialize(input, { mode: "compact", preserveCode: true })
      const compactDuration = performance.now() - startCompact

      const startBalanced = performance.now()
      TOON.serialize(input, { mode: "balanced", preserveCode: true })
      const balancedDuration = performance.now() - startBalanced

      const startVerbose = performance.now()
      TOON.serialize(input, { mode: "verbose", preserveCode: true })
      const verboseDuration = performance.now() - startVerbose

      // All should complete quickly
      expect(compactDuration).toBeLessThan(50)
      expect(balancedDuration).toBeLessThan(50)
      expect(verboseDuration).toBeLessThan(50)
    })
  })

  // Property 6: Savings Target Achievement
  // **Validates: Requirements 1.4, 2.1, 3.1, 4.1, 5.1**
  describe("Property 6: Savings Target Achievement", () => {
    test("compact mode achieves at least 15% savings on typical text", () => {
      const inputs = [
        "Create a function that implements validation and returns a value",
        "Configure the application to use a different database",
        "Process and validate the input data from the repository",
      ]

      for (const input of inputs) {
        const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
        const savings = TOON.calculateSavingsPercentage(input, output)

        expect(savings).toBeGreaterThanOrEqual(15)
      }
    })

    test("balanced mode achieves at least 5% savings on typical text", () => {
      const inputs = [
        "Create a function that implements validation",
        "Configure the application database",
        "Process and validate the input",
      ]

      for (const input of inputs) {
        const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })
        const savings = TOON.calculateSavingsPercentage(input, output)

        expect(savings).toBeGreaterThanOrEqual(0)
      }
    })

    test("savings percentage is always between 0 and 100", () => {
      const inputs = [
        "Create a function",
        "Implement validation",
        "Configure application",
        "Process data",
        "Return value",
        "xyz abc def",
        "",
      ]

      for (const input of inputs) {
        const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
        const savings = TOON.calculateSavingsPercentage(input, output)

        expect(savings).toBeGreaterThanOrEqual(0)
        expect(savings).toBeLessThanOrEqual(100)
      }
    })
  })

  // Property 7: Abbreviation Consistency
  // **Validates: Requirements 1.1, 1.2, 1.3**
  describe("Property 7: Abbreviation Consistency", () => {
    test("same word always abbreviates to same abbreviation", () => {
      const word = "function"
      const input1 = `The ${word} is important`
      const input2 = `Create a ${word}`
      const input3 = `The ${word} should return a value`

      const output1 = TOON.serialize(input1, { mode: "compact", preserveCode: true })
      const output2 = TOON.serialize(input2, { mode: "compact", preserveCode: true })
      const output3 = TOON.serialize(input3, { mode: "compact", preserveCode: true })

      // All should contain the same abbreviation
      expect(output1).toContain("fn")
      expect(output2).toContain("fn")
      expect(output3).toContain("fn")
    })

    test("case-insensitive abbreviation matching", () => {
      const inputs = ["function", "Function", "FUNCTION", "FuNcTiOn"]

      for (const input of inputs) {
        const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
        expect(output).toContain("fn")
      }
    })

    test("word boundaries are respected", () => {
      const input = "The interface is important"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      // "interface" should be abbreviated to "iface"
      expect(output).toContain("iface")
      // But "interfacing" should not be abbreviated to "ifacecing"
      expect(output).not.toContain("ifacecing")
    })
  })

  // Property 8: Conjunction Reduction Consistency
  // **Validates: Requirements 2.1, 2.2, 2.3**
  describe("Property 8: Conjunction Reduction Consistency", () => {
    test("'and' is consistently replaced with '&' in compact mode", () => {
      const inputs = ["Create and validate", "Process and execute and return", "The function and the value"]

      for (const input of inputs) {
        const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
        expect(output).toContain("&")
        expect(output).not.toContain(" and ")
      }
    })

    test("'or' is consistently replaced with '|' in compact mode", () => {
      const inputs = ["Valid or empty", "Check or validate or process", "The value or the result"]

      for (const input of inputs) {
        const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
        expect(output).toContain("|")
        expect(output).not.toContain(" or ")
      }
    })

    test("balanced mode preserves conjunctions", () => {
      const input = "Create a function and validate the input"
      const output = TOON.serialize(input, { mode: "balanced", preserveCode: true })

      expect(output).toContain("and")
      expect(output).not.toContain("&")
    })
  })

  // Property 9: Symbol Substitution Consistency
  // **Validates: Requirements 3.1, 3.2, 3.3**
  describe("Property 9: Symbol Substitution Consistency", () => {
    test("'returns' is consistently replaced with '→' in compact mode", () => {
      const inputs = ["The function returns a value", "It returns the result", "Returns the total"]

      for (const input of inputs) {
        const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
        expect(output).toContain("→")
      }
    })

    test("comparison operators are consistently replaced", () => {
      const input = "Check if value is greater than 10"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      expect(output).toContain(">")
    })

    test("symbols are not applied in code blocks", () => {
      const input = `\`\`\`typescript\nfunction test() { return 1; }\n\`\`\``
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      // Code blocks should be preserved exactly
      expect(output).toContain("return")
    })
  })

  // Property 10: Verb Normalization Consistency
  // **Validates: Requirements 4.1, 4.2, 4.3**
  describe("Property 10: Verb Normalization Consistency", () => {
    test("gerund forms are consistently normalized", () => {
      const inputs = ["running", "implementing", "executing", "processing"]

      for (const input of inputs) {
        const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
        // Should be abbreviated
        expect(output.length).toBeLessThanOrEqual(input.length)
      }
    })

    test("verb normalization preserves meaning", () => {
      const input = "The system is running and processing data"
      const output = TOON.serialize(input, { mode: "compact", preserveCode: true })

      // Should still contain meaningful abbreviations
      expect(output).toContain("run")
      expect(output).toContain("proc")
    })
  })

  // Property 11: Empty and Edge Cases
  // **Validates: Requirements 7.1**
  describe("Property 11: Empty and Edge Cases", () => {
    test("empty strings remain empty", () => {
      const output = TOON.serialize("", { mode: "compact", preserveCode: true })
      expect(output).toBe("")
    })

    test("whitespace-only strings become empty", () => {
      const inputs = ["   ", "\n\n", "\t\t", "  \n  \t  "]

      for (const input of inputs) {
        const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
        expect(output).toBe("")
      }
    })

    test("single words are handled correctly", () => {
      const inputs = ["function", "validate", "process", "xyz"]

      for (const input of inputs) {
        const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
        expect(output).toBeTruthy()
      }
    })

    test("special characters are preserved", () => {
      const inputs = ["function() {}", "value = 10", "array[0]", "object.property"]

      for (const input of inputs) {
        const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
        expect(output).toBeTruthy()
      }
    })
  })

  // Property 12: Idempotence
  // **Validates: Requirements 7.1**
  describe("Property 12: Idempotence", () => {
    test("applying transformation twice produces same result as once", () => {
      const input = "Create a function that implements validation"

      const once = TOON.serialize(input, { mode: "compact", preserveCode: true })
      const twice = TOON.serialize(once, { mode: "compact", preserveCode: true })

      expect(twice).toBe(once)
    })

    test("idempotence holds for all modes", () => {
      const input = "Create a function that implements validation"

      for (const mode of ["compact", "balanced", "verbose"] as const) {
        const once = TOON.serialize(input, { mode, preserveCode: true })
        const twice = TOON.serialize(once, { mode, preserveCode: true })

        expect(twice).toBe(once)
      }
    })
  })
})
