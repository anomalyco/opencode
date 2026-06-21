import { describe, expect, test } from "bun:test"
import { summariseAdvisorOutput } from "@/evolution/decision/engine"

describe("G4-D02 — Evidence DTO verification", () => {
  describe("summariseAdvisorOutput", () => {
    test("risk assessment with 2 risks", () => {
      const output = {
        risks: [
          { description: "Token spike", severity: "medium", category: "technical" },
          { description: "Edge case", severity: "low", category: "operational" },
        ],
        overallSeverity: "low",
        rationale: "Acceptable",
      }
      expect(summariseAdvisorOutput(output)).toBe("2 risks identified")
    })

    test("risk assessment with 0 risks", () => {
      const output = { risks: [], overallSeverity: "low", rationale: "None" }
      expect(summariseAdvisorOutput(output)).toBe("0 risks identified")
    })

    test("execution plan with 3 phases, 7 steps", () => {
      const output = {
        phases: [
          { name: "Analysis", steps: ["Review code", "Identify patterns"], estimatedEffort: "1d" },
          { name: "Implementation", steps: ["Refactor", "Test", "Deploy"], estimatedEffort: "3d" },
          { name: "Validation", steps: ["QA review", "Benchmark"], estimatedEffort: "1d" },
        ],
        estimatedComplexity: 3,
        rationale: "Incremental",
      }
      expect(summariseAdvisorOutput(output)).toBe("3 phases, 7 steps")
    })

    test("execution plan with 1 phase, 1 step", () => {
      const output = {
        phases: [{ name: "Quick fix", steps: ["Patch"], estimatedEffort: "1h" }],
        estimatedComplexity: 1,
        rationale: "Simple",
      }
      expect(summariseAdvisorOutput(output)).toBe("1 phases, 1 steps")
    })

    test("steps-based output (fallback)", () => {
      const output = { steps: ["Step A", "Step B", "Step C"], description: "Generic" }
      expect(summariseAdvisorOutput(output)).toBe("3 steps")
    })

    test("unknown output shape", () => {
      const output = { foo: "bar" }
      expect(summariseAdvisorOutput(output)).toBe("completed")
    })

    test("empty object", () => {
      expect(summariseAdvisorOutput({})).toBe("completed")
    })
  })
})
