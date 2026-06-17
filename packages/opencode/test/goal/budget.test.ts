import { describe, expect, test } from "bun:test"
import {
  applyBudgetUsage,
  checkGoalBudget,
  isBudgetExceeded,
  renderBudgetSummary,
} from "@/goal/budget"
import { GoalBudgetExceededError } from "@/goal/errors"
import type { Goal } from "@/goal/types"

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal_123",
    title: "Migrate repository to Bun",
    objective: "Migrate repository to Bun and verify package checks pass.",
    state: "ACTIVE",
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
    progress: {
      totalSteps: 1,
      completedSteps: 0,
      failedSteps: 0,
      blockedSteps: 0,
      percentComplete: 0,
    },
    budget: {
      usedTokens: 0,
      usedRuntimeMs: 0,
      usedSteps: 0,
      usedCostUsd: 0,
      maxSteps: 2,
      maxRuntimeMs: 1_000,
    },
    ...overrides,
  }
}

describe("goal budget", () => {
  test("applies step and runtime usage immutably", () => {
    const original = goal()
    const updated = applyBudgetUsage(original, { steps: 1, runtimeMs: 250 })

    expect(original.budget.usedSteps).toBe(0)
    expect(original.budget.usedRuntimeMs).toBe(0)
    expect(updated.budget.usedSteps).toBe(1)
    expect(updated.budget.usedRuntimeMs).toBe(250)
  })

  test("detects budget within configured limits", () => {
    const current = goal({
      budget: {
        usedTokens: 0,
        usedRuntimeMs: 500,
        usedSteps: 1,
        usedCostUsd: 0,
        maxSteps: 2,
        maxRuntimeMs: 1_000,
      },
    })

    expect(isBudgetExceeded(current)).toBe(false)
    expect(checkGoalBudget(current)).toBeNull()
  })

  test("detects exceeded step budget", () => {
    const current = goal({
      budget: {
        usedTokens: 0,
        usedRuntimeMs: 0,
        usedSteps: 3,
        usedCostUsd: 0,
        maxSteps: 2,
      },
    })

    const exceeded = checkGoalBudget(current)
    expect(exceeded).toBeInstanceOf(GoalBudgetExceededError)
    expect(exceeded).toMatchObject({ metric: "steps", used: 3, max: 2 })
    expect(isBudgetExceeded(current)).toBe(true)
  })

  test("detects exceeded runtime budget", () => {
    const current = goal({
      budget: {
        usedTokens: 0,
        usedRuntimeMs: 1_001,
        usedSteps: 0,
        usedCostUsd: 0,
        maxRuntimeMs: 1_000,
      },
    })

    const exceeded = checkGoalBudget(current)
    expect(exceeded).toBeInstanceOf(GoalBudgetExceededError)
    expect(exceeded).toMatchObject({ metric: "runtime", used: 1_001, max: 1_000 })
  })

  test("renders budget summary", () => {
    expect(renderBudgetSummary(goal().budget)).toContain("Steps: 0 / 2")
    expect(renderBudgetSummary(goal().budget)).toContain("Runtime: 0 / 1000")
  })
})
