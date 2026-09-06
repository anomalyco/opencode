import { describe, expect, test } from "bun:test"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { ReflectionState } from "@opencode-ai/core/session/runner/reflection-state"
import { ReflectionMetric } from "@opencode-ai/core/session/runner/reflection-metric"

describe("Self-consistency voting", () => {
  const sessionID = "ses_reasoning_test_1" as SessionSchema.ID

  test("isDistributionFlat detects flat hypothesis distribution", () => {
    ReflectionState.clear(sessionID)
    expect(ReflectionState.isDistributionFlat(sessionID)).toBe(false)

    // Single hypothesis - not flat
    ReflectionState.setHypotheses(sessionID, [
      { description: "H1", probability: 1.0, evidence: [] },
    ])
    expect(ReflectionState.isDistributionFlat(sessionID)).toBe(false)

    // Skewed hypotheses (0.85 vs 0.15) - not flat
    ReflectionState.setHypotheses(sessionID, [
      { description: "H1", probability: 0.85, evidence: [] },
      { description: "H2", probability: 0.15, evidence: [] },
    ])
    expect(ReflectionState.isDistributionFlat(sessionID)).toBe(false)

    // Flat hypotheses (0.52 vs 0.48, gap 0.04 < 0.15) - flat!
    ReflectionState.setHypotheses(sessionID, [
      { description: "H1", probability: 0.52, evidence: [] },
      { description: "H2", probability: 0.48, evidence: [] },
    ])
    expect(ReflectionState.isDistributionFlat(sessionID)).toBe(true)
  })

  test("computeMajorityVote clusters and selects consensus winner", () => {
    const candidates = [
      { name: "read_file", input: { path: "src/index.ts" } },
      { name: "run_command", input: { command: "ls" } },
      { name: "read_file", input: { path: "src/index.ts" } },
    ]

    const result = ReflectionState.computeMajorityVote(candidates)
    expect(result).toBeDefined()
    expect(result?.winner.name).toBe("read_file")
    expect(result?.winner.input).toEqual({ path: "src/index.ts" })
    expect(result?.votes).toBe(2)
    expect(result?.totalCandidates).toBe(3)
    expect(result?.consensusRatio).toBe(0.67)
    expect(result?.hadTie).toBe(false)
  })

  test("computeMajorityVote handles single candidate and ties", () => {
    const single = [{ name: "write_file", input: { path: "a.txt" } }]
    const singleVote = ReflectionState.computeMajorityVote(single)
    expect(singleVote?.votes).toBe(1)
    expect(singleVote?.consensusRatio).toBe(1)

    const tie = [
      { name: "toolA", input: {} },
      { name: "toolB", input: {} },
    ]
    const tieVote = ReflectionState.computeMajorityVote(tie)
    expect(tieVote?.votes).toBe(1)
    expect(tieVote?.hadTie).toBe(true)
  })
})

describe("Learned Hedge Thresholds", () => {
  const agent = "coder"
  const model = "test-model"

  test("initializes with default threshold and updates adaptively", () => {
    const initialThreshold = ReflectionMetric.getLearnedHedgeThreshold(agent, model)
    expect(initialThreshold).toBe(0.25)

    // Steered outcome: reflection was useful, lower threshold to catch earlier
    const t1 = ReflectionMetric.updateLearnedHedgeThreshold(agent, model, { steered: true })
    expect(t1).toBe(0.22)
    expect(ReflectionMetric.getLearnedHedgeThreshold(agent, model)).toBe(0.22)

    // Unsteered (converged) outcome: reflection was unnecessary, raise threshold
    const t2 = ReflectionMetric.updateLearnedHedgeThreshold(agent, model, { steered: false })
    expect(t2).toBe(0.24)
  })

  test("shouldTriggerLearnedHedge compares against learned threshold", () => {
    // Current threshold is 0.24
    expect(ReflectionMetric.shouldTriggerLearnedHedge(agent, model, 0.20)).toBe(false)
    expect(ReflectionMetric.shouldTriggerLearnedHedge(agent, model, 0.25)).toBe(true)
  })
})
