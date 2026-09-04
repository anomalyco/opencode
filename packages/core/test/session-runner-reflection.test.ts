import { describe, expect, it } from "bun:test"
import { SessionSchema } from "../src/session/schema"
import { containsHedge } from "../src/session/runner/hedge"
import {
  cofinality,
  hasPolarityDivergence,
  isContradiction,
  jaccard,
  objectiveGap,
  rho,
  tokensOf,
} from "../src/session/runner/reflection-metric"
import { ReflectionState } from "../src/session/runner/reflection-state"
import { EVI } from "../src/session/runner/evi"

describe("containsHedge", () => {
  it("detects standard epistemic hedges", () => {
    expect(containsHedge("Maybe we should try another approach.")).toBe(true)
    expect(containsHedge("I think this file is missing.")).toBe(true)
    expect(containsHedge("Perhaps the port is occupied.")).toBe(true)
    expect(containsHedge("I'm not sure about the return value.")).toBe(true)
  })

  it("detects formal hypothesis and assumption markers", () => {
    expect(containsHedge("Assuming that the configuration is valid...")).toBe(true)
    expect(containsHedge("Let's assume the user has logged in.")).toBe(true)
    expect(containsHedge("Suppose that table orders does not exist.")).toBe(true)
    expect(containsHedge("Hypothetically, the queue could overflow.")).toBe(true)
  })

  it("ignores hedges inside fenced code blocks", () => {
    const textWithCodeBlock = [
      "Here is the implementation:",
      "```ts",
      "// maybe this will fail",
      "const x = 42",
      "```",
      "I have implemented the solution.",
    ].join("\n")
    expect(containsHedge(textWithCodeBlock)).toBe(false)
  })

  it("ignores hedges inside inline code", () => {
    const textWithInlineCode = "The variable `maybe` is set to true in the module."
    expect(containsHedge(textWithInlineCode)).toBe(false)
  })

  it("ignores hedges inside blockquotes", () => {
    const textWithBlockquote = [
      "The user remarked:",
      "> maybe we should test this first",
      "Executing the test suite now.",
    ].join("\n")
    expect(containsHedge(textWithBlockquote)).toBe(false)
  })

  it("returns false for confident assertions", () => {
    expect(containsHedge("The test suite passed with 0 failures.")).toBe(false)
    expect(containsHedge("Writing the output file to disk.")).toBe(false)
  })
})

describe("ReflectionMetric", () => {
  it("tokenizes text accurately", () => {
    const tokens = tokensOf("SELECT * FROM users WHERE status = 'active'")
    expect(tokens.has("select")).toBe(true)
    expect(tokens.has("users")).toBe(true)
    expect(tokens.has("status")).toBe(true)
    expect(tokens.has("active")).toBe(true)
  })

  it("computes Jaccard set similarity", () => {
    const a = new Set(["a", "b", "c"])
    const b = new Set(["b", "c", "d"])
    expect(jaccard(a, b)).toBe(0.5)
    expect(jaccard(new Set(), new Set())).toBe(1)
  })

  it("detects polarity divergence between contrary assertions", () => {
    const affirmative = tokensOf("delete database production")
    const negated = tokensOf("do not delete database production")
    expect(hasPolarityDivergence(affirmative, negated)).toBe(true)

    const bothAffirmative = tokensOf("create database production")
    expect(hasPolarityDivergence(affirmative, bothAffirmative)).toBe(false)

    const bothNegated = tokensOf("cannot delete database production")
    expect(hasPolarityDivergence(negated, bothNegated)).toBe(false)
  })

  it("penalizes rho distance when statements have opposite polarity", () => {
    const affirmative = "delete the database table"
    const negated = "do not delete the database table"
    const distance = rho(affirmative, negated)
    expect(distance).toBeGreaterThanOrEqual(0.5)

    const identical = "run the migration"
    expect(rho(identical, identical)).toBe(0)
  })

  it("identifies logical contradictions sharing vocabulary", () => {
    const statementA = "deploy the production database migration"
    const statementB = "do not deploy the production database migration"
    expect(isContradiction(statementA, statementB)).toBe(true)

    const unrelated = "read file readme markdown"
    expect(isContradiction(statementA, unrelated)).toBe(false)
  })

  it("computes objectiveGap", () => {
    const initial = "build the application"
    const muR = "build the application"
    const tauR = "test the application"
    const gap = objectiveGap(initial, muR, tauR)
    expect(gap).toBeGreaterThan(0)
  })

  it("computes cofinality based on extension count", () => {
    expect(cofinality(0)).toBe("omega")
    expect(cofinality(1)).toBe("transfinite")
    expect(cofinality(5)).toBe("transfinite")
  })
})

describe("ReflectionState", () => {
  const sessionID = SessionSchema.ID.make("ses_test_reflection")

  const baseState = {
    directionConfirmed: true,
    lastWhyConverged: true,
    lastThenConverged: true,
    steers: [] as string[],
    hypotheses: [] as readonly ReflectionState.Hypothesis[],
    confidenceHistory: [] as readonly ReflectionState.ConfidenceRecord[],
    causalNodes: [] as readonly ReflectionState.CausalNode[],
    causalEdges: [] as readonly ReflectionState.CausalEdge[],
    reasoningLog: [] as readonly ReflectionState.ReasoningLogEntry[],
    riskBudget: { used: 0, limit: 100 },
    temporalGuards: [] as readonly ReflectionState.TemporalGuard[],
  }

  it("accumulates steers and sets directionConfirmed to false", () => {
    ReflectionState.clear(sessionID)
    ReflectionState.set(sessionID, baseState)
    expect(ReflectionState.hasSteers(sessionID)).toBe(false)

    ReflectionState.addSteer(sessionID, "[Then Loop forward check]\nRisk of deadlock")
    expect(ReflectionState.hasSteers(sessionID)).toBe(true)
    expect(ReflectionState.get(sessionID).directionConfirmed).toBe(false)

    ReflectionState.addSteer(sessionID, "[Why Loop reflection]\nGoal updated")
    expect(ReflectionState.get(sessionID).steers).toEqual([
      "[Then Loop forward check]\nRisk of deadlock",
      "[Why Loop reflection]\nGoal updated",
    ])
  })

  it("consumes steer guidance text and clears pending steers", () => {
    ReflectionState.clear(sessionID)
    ReflectionState.addSteer(sessionID, "[Why Loop reflection]\nInvestigate syntax error")

    const guidance = ReflectionState.consumeSteerGuidanceText(sessionID)
    expect(guidance).toContain("<reflection_guidance>")
    expect(guidance).toContain("[Why Loop reflection]\nInvestigate syntax error")
    expect(guidance).toContain("</reflection_guidance>")

    // Once consumed, subsequent call returns undefined
    expect(ReflectionState.consumeSteerGuidanceText(sessionID)).toBeUndefined()
    expect(ReflectionState.hasSteers(sessionID)).toBe(false)
  })

  it("clearDirection resets confirmation while preserving steers", () => {
    ReflectionState.clear(sessionID)
    ReflectionState.set(sessionID, {
      ...baseState,
      steers: ["pending steer"],
    })

    ReflectionState.clearDirection(sessionID)
    const state = ReflectionState.get(sessionID)
    expect(state.directionConfirmed).toBe(false)
    expect(state.lastWhyConverged).toBe(false)
    expect(state.lastThenConverged).toBe(false)
    expect(state.steers).toEqual(["pending steer"])
  })

  it("tracks hypotheses and includes them in reflection text", () => {
    ReflectionState.clear(sessionID)
    ReflectionState.setHypotheses(sessionID, [
      { description: "Missing import in index.ts", probability: 0.7, evidence: [] },
      { description: "TypeScript version conflict", probability: 0.3, evidence: [] },
    ])

    const hypotheses = ReflectionState.getHypotheses(sessionID)
    expect(hypotheses.length).toBe(2)
    expect(hypotheses[0].description).toBe("Missing import in index.ts")
    expect(hypotheses[0].probability).toBe(0.7)

    const reflectionText = ReflectionState.getReflectionText(sessionID)
    expect(reflectionText).toContain("Active competing hypotheses:")
    expect(reflectionText).toContain("[70%] Missing import in index.ts")
    expect(reflectionText).toContain("[30%] TypeScript version conflict")
  })

  it("manages temporal guards and updates their status", () => {
    ReflectionState.clear(sessionID)
    const guardId = ReflectionState.addTemporalGuard(sessionID, {
      formula: "always(typecheck_passes)",
      description: "Code must typecheck before committing",
    })

    const guards = ReflectionState.getTemporalGuards(sessionID)
    expect(guards.length).toBe(1)
    expect(guards[0].status).toBe("pending")

    ReflectionState.updateTemporalGuard(sessionID, guardId, "violated")
    expect(ReflectionState.getTemporalGuards(sessionID)[0].status).toBe("violated")
  })

  it("manages risk budget", () => {
    ReflectionState.clear(sessionID)
    ReflectionState.resetRiskBudget(sessionID, 50)
    expect(ReflectionState.getRiskBudget(sessionID)).toEqual({ used: 0, limit: 50, remaining: 50 })

    const allowed = ReflectionState.consumeRiskBudget(sessionID, 30)
    expect(allowed).toBe(true)
    expect(ReflectionState.getRiskBudget(sessionID).remaining).toBe(20)

    const denied = ReflectionState.consumeRiskBudget(sessionID, 30)
    expect(denied).toBe(false)
    expect(ReflectionState.getRiskBudget(sessionID).remaining).toBe(20)
  })

  it("records and retrieves reasoning log entries", () => {
    ReflectionState.clear(sessionID)
    ReflectionState.addReasoningLog(sessionID, {
      type: "why_loop",
      content: "Soundness verified",
      metadata: { converged: true },
    })

    const log = ReflectionState.getReasoningLog(sessionID)
    expect(log.length).toBe(1)
    expect(log[0].type).toBe("why_loop")
    expect(log[0].content).toBe("Soundness verified")
  })
})

describe("EVI", () => {
  it("computes Shannon entropy accurately", () => {
    expect(EVI.entropy([1.0])).toBe(0)
    expect(EVI.entropy([0.5, 0.5])).toBe(1.0)
    expect(EVI.entropy([])).toBe(0)
  })

  it("scores diagnostic tools higher than mutative tools when uncertainty is high", () => {
    const hypotheses = [
      { description: "Syntax error in file A", probability: 0.5 },
      { description: "Syntax error in file B", probability: 0.5 },
    ]

    const readScore = EVI.scoreToolEVI("read", hypotheses)
    const writeScore = EVI.scoreToolEVI("write", hypotheses)

    expect(readScore.isDiagnostic).toBe(true)
    expect(writeScore.isDiagnostic).toBe(false)
    expect(readScore.score).toBeGreaterThan(writeScore.score)
  })

  it("generates EVI guidance text when hypothesis entropy exceeds threshold", () => {
    const highEntropy = [
      { description: "Hypothesis A", probability: 0.5 },
      { description: "Hypothesis B", probability: 0.5 },
    ]
    const guidance = EVI.guidanceTextForEVI(highEntropy)
    expect(guidance).toBeDefined()
    expect(guidance).toContain("[Expected Value of Information (EVI)]")
    expect(guidance).toContain("Prioritize high-EVI diagnostic actions")

    const lowEntropy = [{ description: "Certain cause", probability: 1.0 }]
    expect(EVI.guidanceTextForEVI(lowEntropy)).toBeUndefined()
  })
})
