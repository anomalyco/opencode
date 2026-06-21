import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"

// --- Static analysis tests ---

describe("G4-04 — Enrichment Pipeline integration", () => {
  const engineSrc = readFileSync(
    new URL("../../../src/evolution/decision/engine.ts", import.meta.url),
    "utf-8",
  )

  test("generator/advisors split uses proposal capability check", () => {
    expect(engineSrc).toContain('.capabilities.includes("proposal"')
  })

  test("winner selected from generatorResults only (REQ-05)", () => {
    const reconcileSection = engineSrc.slice(engineSrc.indexOf("const reconcile ="))
    // Committee consensus replaces the old ConfidenceReconciliationStrategy
    const committeeCall = reconcileSection.indexOf("runCommittee(agentOutputs)")
    expect(committeeCall).not.toBe(-1)
    // Verify candidates = generatorResults, not allResults
    const candidatesDecl = reconcileSection.includes("const candidates = generatorResults.map")
    expect(candidatesDecl).toBe(true)
  })

  test("zero proposal-capable agents fails with NO_CANDIDATES (REQ-05 guard)", () => {
    expect(engineSrc).toContain('"NO_CANDIDATES: zero proposal-capable agents"')
  })

  test("advisor output not submitted as proposal (AR-001)", () => {
    // The engine outputs selectedAgentId; activation uses it as proposer
    expect(engineSrc).toContain("selectedAgentId")
    // No direct advisor output submission
    const advisorSubmitPattern = engineSrc.match(/advisorResult.*submit/i)
    expect(advisorSubmitPattern).toBeNull()
  })
})

describe("G4-05 — buildOutputParticipants (enrichment pipeline)", () => {
  test("imports engine: buildParticipants is module-private (not exported)", () => {
    const engineSrc = readFileSync(
      new URL("../../../src/evolution/decision/engine.ts", import.meta.url),
      "utf-8",
    )
    expect(engineSrc).toMatch(/function buildParticipants\b/)
    expect(engineSrc).not.toMatch(/export\s+(function|const)\s+buildParticipants/)
  })

  test("engine creates participants from allResults (not generatorResults only)", () => {
    const engineSrc = readFileSync(
      new URL("../../../src/evolution/decision/engine.ts", import.meta.url),
      "utf-8",
    )
    expect(engineSrc).toContain("buildOutputParticipants(allResults,")
  })

  test("each participant has agentId, capabilities, contributionType, confidenceScore, selected", () => {
    const engineSrc = readFileSync(
      new URL("../../../src/evolution/decision/engine.ts", import.meta.url),
      "utf-8",
    )
    // Verify the buildParticipants function constructs ParticipantEntry correctly
    expect(engineSrc).toContain("agentId: r.manifest.id")
    expect(engineSrc).toContain("capabilities: r.manifest.capabilities")
    expect(engineSrc).toContain("contributionType")
    expect(engineSrc).toContain("confidenceScore")
    expect(engineSrc).toContain("selected:")
  })

  test("generator contributionType is 'proposal'", () => {
    const engineSrc = readFileSync(
      new URL("../../../src/evolution/decision/engine.ts", import.meta.url),
      "utf-8",
    )
    expect(engineSrc).toContain('contributionType: isGenerator ? "proposal"')
  })

  test("advisor contributionType uses first capability", () => {
    const engineSrc = readFileSync(
      new URL("../../../src/evolution/decision/engine.ts", import.meta.url),
      "utf-8",
    )
    expect(engineSrc).toContain("r.manifest.capabilities[0]")
  })

  test("advisor confidenceScore is 0 (not calculated)", () => {
    const engineSrc = readFileSync(
      new URL("../../../src/evolution/decision/engine.ts", import.meta.url),
      "utf-8",
    )
    expect(engineSrc).toContain("confidence = candidate ? calcConfidence(candidate) : 0")
  })
})

describe("G4-06 — Agent isolation rules", () => {
  test("risk-agent does not import ProposalCandidate", () => {
    const src = readFileSync(
      new URL("../../../src/evolution/decision/agents/risk.ts", import.meta.url),
      "utf-8",
    )
    expect(src).not.toContain("ProposalCandidate")
  })

  test("risk-agent does not export proposal-related types", () => {
    const src = readFileSync(
      new URL("../../../src/evolution/decision/agents/risk.ts", import.meta.url),
      "utf-8",
    )
    expect(src).not.toMatch(/export\s+.*proposal/i)
  })

  test("planning-agent does not import ProposalCandidate", () => {
    const src = readFileSync(
      new URL("../../../src/evolution/decision/agents/planning.ts", import.meta.url),
      "utf-8",
    )
    expect(src).not.toContain("ProposalCandidate")
  })

  test("planning-agent does not export proposal-related types", () => {
    const src = readFileSync(
      new URL("../../../src/evolution/decision/agents/planning.ts", import.meta.url),
      "utf-8",
    )
    expect(src).not.toMatch(/export\s+.*proposal/i)
  })

  test("risk-agent outputs RiskAssessmentSchema (not ProposalCandidate)", () => {
    const src = readFileSync(
      new URL("../../../src/evolution/decision/agents/risk.ts", import.meta.url),
      "utf-8",
    )
    expect(src).toContain("Effect.Effect<RiskAssessment")
    expect(src).toContain("RISK_ASSESSMENT_SCHEMA")
  })

  test("planning-agent outputs ExecutionPlanSchema (not ProposalCandidate)", () => {
    const src = readFileSync(
      new URL("../../../src/evolution/decision/agents/planning.ts", import.meta.url),
      "utf-8",
    )
    expect(src).toContain("Effect.Effect<ExecutionPlan")
    expect(src).toContain("EXECUTION_PLAN_SCHEMA")
  })
})
