import { describe, expect, test } from "bun:test"
import { Schema, Option } from "effect"
import { RISK_ASSESSMENT_SCHEMA as RiskAssessmentSchema } from "@/evolution/decision/agents/risk"
import { EXECUTION_PLAN_SCHEMA as ExecutionPlanSchema } from "@/evolution/decision/agents/planning"

describe("G4-02 — RISK_ASSESSMENT_SCHEMA validation", () => {
  const decode = Schema.decodeUnknownOption(RiskAssessmentSchema)

  const valid = {
    risks: [
      { description: "Token usage spike", severity: "low", category: "technical" },
    ],
    overallSeverity: "low",
    recommendationCategory: "APPROVE",
    rationale: "Acceptable risk",
  }

  test("valid risk assessment decodes", () => {
    expect(Option.isSome(decode(valid))).toBe(true)
  })

  test("invalid overallSeverity fails", () => {
    const bad = { ...valid, overallSeverity: "extreme" }
    expect(Option.isNone(decode(bad))).toBe(true)
  })

  test("invalid severity in risk fails", () => {
    const bad = { ...valid, risks: [{ ...valid.risks[0], severity: "unknown" }] }
    expect(Option.isNone(decode(bad))).toBe(true)
  })

  test("invalid category in risk fails", () => {
    const bad = { ...valid, risks: [{ ...valid.risks[0], category: "unknown" }] }
    expect(Option.isNone(decode(bad))).toBe(true)
  })

  test("non-array risks fails", () => {
    const bad = { ...valid, risks: "none" }
    expect(Option.isNone(decode(bad))).toBe(true)
  })
})

describe("G4-03 — EXECUTION_PLAN_SCHEMA validation", () => {
  const decode = Schema.decodeUnknownOption(ExecutionPlanSchema)

  const valid = {
    phases: [
      { name: "Phase 1", steps: ["Lint codebase"], estimatedEffort: "2h" },
    ],
    estimatedComplexity: 3,
    rationale: "Straightforward plan",
  }

  test("valid execution plan decodes", () => {
    expect(Option.isSome(decode(valid))).toBe(true)
  })

  test("non-array phases fails", () => {
    const bad = { ...valid, phases: "none" }
    expect(Option.isNone(decode(bad))).toBe(true)
  })

  test("string steps rejected (should be array)", () => {
    const bad = { ...valid, phases: [{ ...valid.phases[0], steps: "lint" }] }
    expect(Option.isNone(decode(bad))).toBe(true)
  })

  test("estimatedComplexity is number, not string", () => {
    const bad = { ...valid, estimatedComplexity: "moderate" }
    expect(Option.isNone(decode(bad))).toBe(true)
  })
})
