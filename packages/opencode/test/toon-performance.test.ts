import { describe, test, expect } from "bun:test"
import { TOON } from "../src/format/toon"

describe("TOON Performance Tests", () => {
  describe("Transformation Speed", () => {
    test("transforms short text quickly", () => {
      const text = "Create a function that returns a value"
      const start = performance.now()
      
      for (let i = 0; i < 1000; i++) {
        TOON.serialize(text, { mode: "balanced", preserveCode: true })
      }
      
      const duration = performance.now() - start
      
      // Should complete 1000 transformations in less than 100ms
      expect(duration).toBeLessThan(100)
    })

    test("handles large text efficiently", () => {
      const largeText = "Create a function with parameters that returns values. ".repeat(1000)
      const start = performance.now()
      
      TOON.serialize(largeText, { mode: "balanced", preserveCode: true })
      
      const duration = performance.now() - start
      
      // Should complete in less than 50ms
      expect(duration).toBeLessThan(50)
    })

    test("code preservation doesn't significantly impact performance", () => {
      const textWithCode = `Here is a function:
\`\`\`typescript
${"function test() {}\n".repeat(100)}
\`\`\`
Please review it.`

      const startWithPreserve = performance.now()
      TOON.serialize(textWithCode, { mode: "balanced", preserveCode: true })
      const durationWithPreserve = performance.now() - startWithPreserve

      const startWithoutPreserve = performance.now()
      TOON.serialize(textWithCode, { mode: "balanced", preserveCode: false })
      const durationWithoutPreserve = performance.now() - startWithoutPreserve

      // Difference should be minimal (less than 10ms)
      expect(Math.abs(durationWithPreserve - durationWithoutPreserve)).toBeLessThan(10)
    })
  })

  describe("Memory Efficiency", () => {
    test("doesn't create excessive intermediate strings", () => {
      const text = "Create a function with parameters".repeat(100)
      
      // Measure memory before
      const memBefore = process.memoryUsage().heapUsed
      
      for (let i = 0; i < 100; i++) {
        TOON.serialize(text, { mode: "balanced", preserveCode: true })
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc()
      }
      
      const memAfter = process.memoryUsage().heapUsed
      const memIncrease = memAfter - memBefore
      
      // Memory increase should be reasonable (less than 10MB)
      expect(memIncrease).toBeLessThan(10 * 1024 * 1024)
    })
  })

  describe("Savings Consistency", () => {
    test("produces consistent savings for same input", () => {
      const text = "Create a function that takes parameters and returns values"
      const results: number[] = []
      
      for (let i = 0; i < 10; i++) {
        const transformed = TOON.serialize(text, { mode: "balanced", preserveCode: true })
        const savings = TOON.estimateSavings(text, transformed)
        results.push(savings)
      }
      
      // All results should be identical
      expect(new Set(results).size).toBe(1)
    })

    test("savings scale with input size", () => {
      const baseText = "Create a function with parameters"
      
      const small = baseText
      const medium = baseText.repeat(10)
      const large = baseText.repeat(100)
      
      const smallSavings = TOON.estimateSavings(
        small,
        TOON.serialize(small, { mode: "balanced", preserveCode: true })
      )
      
      const mediumSavings = TOON.estimateSavings(
        medium,
        TOON.serialize(medium, { mode: "balanced", preserveCode: true })
      )
      
      const largeSavings = TOON.estimateSavings(
        large,
        TOON.serialize(large, { mode: "balanced", preserveCode: true })
      )
      
      // Savings should scale proportionally
      expect(mediumSavings).toBeGreaterThan(smallSavings * 5)
      expect(largeSavings).toBeGreaterThan(mediumSavings * 5)
    })
  })

  describe("Mode Comparison", () => {
    test("compact mode saves more than balanced", () => {
      const text = "Create a function that takes a parameter and returns the value from the database"
      
      const compactResult = TOON.serialize(text, { mode: "compact", preserveCode: true })
      const balancedResult = TOON.serialize(text, { mode: "balanced", preserveCode: true })
      
      const compactSavings = TOON.estimateSavings(text, compactResult)
      const balancedSavings = TOON.estimateSavings(text, balancedResult)
      
      expect(compactSavings).toBeGreaterThan(balancedSavings)
    })

    test("balanced mode saves more than verbose", () => {
      const text = "Create a function that takes a parameter and returns the value"
      
      const balancedResult = TOON.serialize(text, { mode: "balanced", preserveCode: true })
      const verboseResult = TOON.serialize(text, { mode: "verbose", preserveCode: true })
      
      const balancedSavings = TOON.estimateSavings(text, balancedResult)
      const verboseSavings = TOON.estimateSavings(text, verboseResult)
      
      expect(balancedSavings).toBeGreaterThan(verboseSavings)
    })

    test("all modes produce valid output", () => {
      const text = "Create a function with parameters"
      const modes: TOON.Mode[] = ["compact", "balanced", "verbose"]
      
      for (const mode of modes) {
        const result = TOON.serialize(text, { mode, preserveCode: true })
        
        expect(result).toBeTruthy()
        expect(result.length).toBeGreaterThan(0)
        expect(result.length).toBeLessThanOrEqual(text.length)
      }
    })
  })

  describe("Stress Tests", () => {
    test("handles extremely long text", () => {
      const veryLongText = "Create a function that processes data. ".repeat(10000)
      
      expect(() => {
        TOON.serialize(veryLongText, { mode: "balanced", preserveCode: true })
      }).not.toThrow()
    })

    test("handles many code blocks", () => {
      let textWithManyBlocks = ""
      for (let i = 0; i < 100; i++) {
        textWithManyBlocks += `Code block ${i}:\n\`\`\`ts\nfunction test${i}() {}\n\`\`\`\n`
      }
      
      const result = TOON.serialize(textWithManyBlocks, { mode: "balanced", preserveCode: true })
      
      // All code blocks should be preserved
      expect((result.match(/```/g) || []).length).toBe(200) // 100 blocks * 2 markers
    })

    test("handles nested special characters", () => {
      const specialText = "Create a function() with [parameters] and {returns} the <value>"
      
      expect(() => {
        TOON.serialize(specialText, { mode: "balanced", preserveCode: true })
      }).not.toThrow()
    })

    test("handles unicode and emojis", () => {
      const unicodeText = "Create a función 函数 🚀 with параметры and returns 値"
      
      const result = TOON.serialize(unicodeText, { mode: "balanced", preserveCode: true })
      
      expect(result).toContain("🚀")
      expect(result).toContain("función")
      expect(result).toContain("函数")
    })
  })
})
