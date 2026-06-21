import { describe, expect, test } from "bun:test"
import { Schema, Option } from "effect"
import { ConfigEvolution } from "@/evolution/index"

describe("TG-THRESHOLD — ConfigEvolution minCandidateConfidence parsing", () => {
  const decode = Schema.decodeUnknownOption(ConfigEvolution)

  test("parses valid minCandidateConfidence: 0.3", () => {
    const result = decode({ minCandidateConfidence: 0.3 })
    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value.minCandidateConfidence).toBe(0.3)
    }
  })

  test("parses valid minCandidateConfidence: 0.0 (boundary)", () => {
    const result = decode({ minCandidateConfidence: 0.0 })
    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value.minCandidateConfidence).toBe(0.0)
    }
  })

  test("parses valid minCandidateConfidence: 1.0 (boundary)", () => {
    const result = decode({ minCandidateConfidence: 1.0 })
    expect(Option.isSome(result)).toBe(true)
  })

  test("rejects minCandidateConfidence: -0.1 (below 0)", () => {
    const result = decode({ minCandidateConfidence: -0.1 })
    expect(Option.isNone(result)).toBe(true)
  })

  test("rejects minCandidateConfidence: 1.5 (above 1)", () => {
    const result = decode({ minCandidateConfidence: 1.5 })
    expect(Option.isNone(result)).toBe(true)
  })

  test("parses valid reconciliationStrategy: CONFIDENCE", () => {
    const result = decode({ reconciliationStrategy: "CONFIDENCE" })
    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value.reconciliationStrategy).toBe("CONFIDENCE")
    }
  })

  test("rejects invalid reconciliationStrategy: CONSENSUS", () => {
    const result = decode({ reconciliationStrategy: "CONSENSUS" })
    expect(Option.isNone(result)).toBe(true)
  })

  test("both fields absent is valid (optional)", () => {
    const result = decode({})
    expect(Option.isSome(result)).toBe(true)
  })
})
