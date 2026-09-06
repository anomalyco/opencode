import { describe, expect, test } from "bun:test"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionBudget } from "@opencode-ai/core/session/runner/budget"
import { DecisionTree } from "@opencode-ai/core/session/decision-tree"
import { TimeTravel } from "@opencode-ai/core/session/time-travel"
import { ReflectionState } from "@opencode-ai/core/session/runner/reflection-state"

describe("Budget-Aware Routing (Feature 13)", () => {
  const sessionID = "ses_budget_test" as SessionSchema.ID

  test("calculates accurate token pricing for various model tiers", () => {
    // Claude 3.5 Sonnet: $3 / 1M input, $15 / 1M output
    const costSonnet = SessionBudget.calculateTokenCost("claude-3-5-sonnet-20241022", {
      input: 100_000, // $0.30
      output: 10_000, // $0.15
    })
    expect(costSonnet).toBe(0.45)

    // GPT-4o-mini: $0.15 / 1M input, $0.60 / 1M output
    const costMini = SessionBudget.calculateTokenCost("gpt-4o-mini", {
      input: 100_000, // $0.015
      output: 10_000, // $0.006
    })
    expect(costMini).toBe(0.021)
  })

  test("tracks cumulative session cost and triggers model downgrade when budget depleted", () => {
    SessionBudget.setSessionBudget(sessionID, 1.0) // $1.00 budget limit

    let status = SessionBudget.getBudgetStatus(sessionID)
    expect(status.spentUsd).toBe(0)
    expect(status.shouldDowngrade).toBe(false)

    // Step 1: spend $0.50 (50%)
    status = SessionBudget.recordStepCost(sessionID, 0.50)
    expect(status.spentUsd).toBe(0.50)
    expect(status.percentageSpent).toBe(50)
    expect(status.shouldDowngrade).toBe(false)

    // Step 2: spend another $0.30 -> total $0.80 (80% >= 75% threshold)
    status = SessionBudget.recordStepCost(sessionID, 0.30)
    expect(status.spentUsd).toBe(0.80)
    expect(status.percentageSpent).toBe(80)
    expect(status.shouldDowngrade).toBe(true)
    expect(status.downgradedModel).toBe("claude-3-5-haiku")

    // Fallback recommendation
    expect(SessionBudget.getDowngradedModelFallback("claude-3-5-sonnet")).toBe("claude-3-5-haiku")
    expect(SessionBudget.getDowngradedModelFallback("gpt-4o")).toBe("gpt-4o-mini")
  })
})

describe("Decision-Tree Timeline (Feature 12)", () => {
  const sessionID = "ses_decision_tree_test" as SessionSchema.ID

  test("builds branching hypotheses tree, prunes refuted paths, and verifies survivor", () => {
    // 1. Root goal
    const root = DecisionTree.setRootGoal(sessionID, "Fix flaky test in session runner")
    expect(root.type).toBe("goal")
    expect(root.status).toBe("active")

    // 2. Branch competing hypotheses
    const branches = DecisionTree.branchHypotheses(sessionID, root.id, 1, [
      { description: "Hypothesis A: Race condition in event bus", probability: 0.60 },
      { description: "Hypothesis B: Missing await in tool settlement", probability: 0.40 },
    ])
    expect(branches.length).toBe(2)
    expect(branches[0].status).toBe("active")
    expect(branches[1].status).toBe("active")

    // 3. Prune refuted hypothesis B
    const pruned = DecisionTree.pruneNode(sessionID, branches[1].id, "Checked logs: await is present")
    expect(pruned?.status).toBe("pruned")

    // 4. Verify survivor hypothesis A
    const verified = DecisionTree.verifyNode(sessionID, branches[0].id)
    expect(verified?.status).toBe("verified")

    // 5. Render ASCII visual tree
    const ascii = DecisionTree.renderAsciiTree(sessionID)
    expect(ascii).toContain("[Goal]: Fix flaky test in session runner")
    expect(ascii).toContain("[✓ verified] Hypothesis A: Race condition in event bus")
    expect(ascii).toContain("[✗ pruned] Hypothesis B: Missing await in tool settlement")
  })
})

describe("Time-Travel Debugging (Feature 14)", () => {
  const sessionID = "ses_time_travel_test" as SessionSchema.ID

  test("edits an intermediate assumption and injects time-travel steer", () => {
    ReflectionState.clear(sessionID)
    ReflectionState.setHypotheses(sessionID, [
      { description: "The server runs on port 8080", probability: 0.9, evidence: [] },
      { description: "The auth service is disabled", probability: 0.1, evidence: [] },
    ])

    // Edit intermediate assumption
    const result = TimeTravel.editAssumption(sessionID, {
      oldAssumption: "port 8080",
      newAssumption: "port 3000",
    })

    expect(result.success).toBe(true)
    expect(result.updatedHypothesesCount).toBe(1)

    const updated = ReflectionState.getHypotheses(sessionID)
    expect(updated[0].description).toBe("The server runs on port 3000")

    // Steer guidance injected
    expect(ReflectionState.hasSteers(sessionID)).toBe(true)
    const steerGuidance = ReflectionState.consumeSteerGuidanceText(sessionID)
    expect(steerGuidance).toContain("[Time-Travel Edited Assumption]")
  })
})
