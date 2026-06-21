import { describe, expect, test } from "bun:test"
import { runCommittee, describeConsensus } from "../../../src/evolution/orchestration/committee"
import { isAutoExecutable, explainAutoExecutability } from "../../../src/evolution/governance/approval"
import { calculateSimilarity } from "../../../src/evolution/analysis/semantic-check"
import type { AgentOutput, Decision, RiskAnalystOutput } from "../../../src/evolution/decision/p6-types"

function makeContextAnalyst(action = "adjust-threshold") {
  return { agentId: "context-analyst" as const, proposedAction: action, rationale: "Context suggests adjustment", confidence: 0.85 }
}

function makeRiskAnalyst(assessment: RiskAnalystOutput["assessment"] = "LOW", recommendation: RiskAnalystOutput["recommendation"] = "APPROVE", critical = false): RiskAnalystOutput {
  return { agentId: "risk-analyst" as const, assessment, recommendation, critical, reason: `Risk level is ${assessment}`, recommendationCategory: "OPERATIONAL" }
}

function makePlanningAnalyst(feasible = true) {
  return { agentId: "planning-analyst" as const, feasible, reason: feasible ? "Technically viable" : "Infeasible - resource conflict" }
}

function makeDecision(overrides: Partial<Decision> & { category: Decision["category"] }): Decision {
  return { decisionId: `DEC-${Date.now()}`, proposedAction: "adjust-threshold", consensusOutcome: "UNANIMOUS_APPROVED", rationale: "Test decision", producedAt: Date.now(), ...overrides }
}

describe("P6 — Committee Consensus (TG-H01, TG-H02)", () => {
  test("TG-H01: CRITICAL veto → VETO_HELD", () => {
    const outputs: AgentOutput[] = [makeContextAnalyst(), makeRiskAnalyst("CRITICAL", "REJECT", true), makePlanningAnalyst()]
    expect(runCommittee(outputs).outcome).toBe("VETO_HELD")
  })

  test("TG-H01: HIGH veto with critical=true → VETO_HELD", () => {
    expect(runCommittee([makeContextAnalyst(), makeRiskAnalyst("HIGH", "REJECT", true)]).outcome).toBe("VETO_HELD")
  })

  test("TG-H01: MODIFY with critical=true → VETO_HELD", () => {
    expect(runCommittee([makeContextAnalyst(), makeRiskAnalyst("HIGH", "MODIFY", true)]).outcome).toBe("VETO_HELD")
  })

  test("TG-H01: REJECT with critical=false → continues to consensus", () => {
    expect(runCommittee([makeContextAnalyst("action-A"), makeRiskAnalyst("HIGH", "REJECT", false), makePlanningAnalyst()]).outcome).toBe("UNANIMOUS_APPROVED")
  })

  test("TG-H01: vetoReason is populated", () => {
    const r = runCommittee([makeContextAnalyst(), makeRiskAnalyst("CRITICAL", "REJECT", true)])
    expect(r.vetoReason).toBeDefined()
    expect(r.vetoReason).toContain("REJECT")
  })

  test("TG-H02: PlanningAnalyst infeasible → DISAGREEMENT_HELD", () => {
    expect(runCommittee([makeContextAnalyst(), makeRiskAnalyst("LOW", "APPROVE", false), makePlanningAnalyst(false)]).outcome).toBe("DISAGREEMENT_HELD")
  })

  test("TG-H02: conflicts array populated on disagreement", () => {
    const r = runCommittee([makeContextAnalyst(), makePlanningAnalyst(false)])
    expect(r.outcome).toBe("DISAGREEMENT_HELD")
    expect(r.conflicts).toBeDefined()
    expect(r.conflicts!.length).toBeGreaterThan(0)
  })

  test("NO_PROPOSAL when no context-analyst present", () => {
    expect(runCommittee([makeRiskAnalyst()]).outcome).toBe("NO_PROPOSAL")
  })

  test("UNANIMOUS_APPROVED when all agents agree and feasible", () => {
    const r = runCommittee([makeContextAnalyst("upgrade"), makeRiskAnalyst("LOW", "APPROVE", false), makePlanningAnalyst(true)])
    expect(r.outcome).toBe("UNANIMOUS_APPROVED")
    expect(r.selectedAction).toBe("upgrade")
  })

  test("describeConsensus produces readable strings", () => {
    expect(describeConsensus({ outcome: "UNANIMOUS_APPROVED", selectedAction: "x", timestamp: 0 })).toContain("APPROVED")
    expect(describeConsensus({ outcome: "VETO_HELD", vetoReason: "test", timestamp: 0 })).toContain("VETO_HELD")
    expect(describeConsensus({ outcome: "DISAGREEMENT_HELD", conflicts: ["a vs b"], timestamp: 0 })).toContain("DISAGREEMENT")
    expect(describeConsensus({ outcome: "NO_PROPOSAL", timestamp: 0 })).toContain("NO_PROPOSAL")
  })
})

describe("P6 — Approval Gate (TG-H03, TG-H04)", () => {
  test("TG-H03: CONFIG_THRESHOLD with unanimous consensus → auto-executable", () => {
    expect(isAutoExecutable(makeDecision({ category: "CONFIG_THRESHOLD" }))).toBe(true)
  })

  test("TG-H03: CONFIG_BUDGET → auto-executable", () => {
    expect(isAutoExecutable(makeDecision({ category: "CONFIG_BUDGET" }))).toBe(true)
  })

  test("TG-H03: AGENT_INSTRUCTION → auto-executable", () => {
    expect(isAutoExecutable(makeDecision({ category: "AGENT_INSTRUCTION" }))).toBe(true)
  })

  test("TG-H04: MODE_OPERATION → NOT auto-executable", () => {
    expect(isAutoExecutable(makeDecision({ category: "MODE_OPERATION" }))).toBe(false)
  })

  test("TG-H04: DATA_ARCHITECTURE → NOT auto-executable", () => {
    expect(isAutoExecutable(makeDecision({ category: "DATA_ARCHITECTURE" }))).toBe(false)
  })

  test("TG-H04: MEMORY_ADDITION → NOT auto-executable", () => {
    expect(isAutoExecutable(makeDecision({ category: "MEMORY_ADDITION" }))).toBe(false)
  })

  test("HELD_REVIEW → NOT auto-executable even if category is safe", () => {
    expect(isAutoExecutable(makeDecision({ category: "HELD_REVIEW" }))).toBe(false)
  })

  test("Non-unanimous consensus blocks auto-execution regardless of category", () => {
    expect(isAutoExecutable(makeDecision({ category: "CONFIG_THRESHOLD", consensusOutcome: "VETO_HELD" }))).toBe(false)
    expect(isAutoExecutable(makeDecision({ category: "CONFIG_THRESHOLD", consensusOutcome: "DISAGREEMENT_HELD" }))).toBe(false)
  })

  test("explainAutoExecutability provides reason", () => {
    const d = makeDecision({ category: "MODE_OPERATION" })
    const explanation = explainAutoExecutability(d)
    expect(explanation).toContain("NOT_AUTO_EXECUTABLE")
    expect(explanation).toContain("MODE_OPERATION")
  })
})

describe("P6 — Semantic Check (TG-H08)", () => {
  test("TG-H08: calculateSimilarity always returns 0.0", () => {
    expect(calculateSimilarity("any text", "different text")).toBe(0.0)
    expect(calculateSimilarity("", "")).toBe(0.0)
    expect(calculateSimilarity("same text", "same text")).toBe(0.0)
  })
})
