import { describe, expect, test } from "bun:test"
import {
  runGoalExecutionLoop,
  selectNextGoalStep,
  shouldStopGoalExecution,
} from "@/goal/executor"
import type { Goal, GoalPlan, GoalStep } from "@/goal/types"

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal_123",
    title: "Migrate repository to Bun",
    objective: "Migrate repository to Bun and verify package checks pass.",
    state: "ACTIVE",
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
    progress: {
      totalSteps: 3,
      completedSteps: 1,
      failedSteps: 0,
      blockedSteps: 0,
      percentComplete: 33,
    },
    budget: {
      usedTokens: 0,
      usedRuntimeMs: 0,
      usedSteps: 0,
      usedCostUsd: 0,
    },
    ...overrides,
  }
}

function step(input: Partial<GoalStep> & Pick<GoalStep, "id">): GoalStep {
  return {
    title: input.id,
    description: input.id,
    status: "PENDING",
    dependencies: [],
    verification: [],
    ...input,
  }
}

function plan(steps: GoalStep[]): GoalPlan {
  return {
    id: "plan_123",
    goalId: "goal_123",
    version: 1,
    steps,
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
  }
}

describe("goal executor", () => {
  test("selects first pending step whose dependencies are completed", () => {
    const current = plan([
      step({ id: "inspect", status: "COMPLETED" }),
      step({ id: "design", dependencies: ["inspect"] }),
      step({ id: "implement", dependencies: ["design"] }),
    ])

    expect(selectNextGoalStep(current)?.id).toBe("design")
  })

  test("does not select a pending step with incomplete dependencies", () => {
    const current = plan([
      step({ id: "inspect", status: "PENDING" }),
      step({ id: "design", dependencies: ["inspect"] }),
    ])

    expect(selectNextGoalStep(current)?.id).toBe("inspect")
  })

  test("returns undefined when all steps are complete", () => {
    const current = plan([
      step({ id: "inspect", status: "COMPLETED" }),
      step({ id: "design", status: "COMPLETED", dependencies: ["inspect"] }),
    ])

    expect(selectNextGoalStep(current)).toBeUndefined()
  })

  test("stops execution for non-runnable goal states", () => {
    expect(shouldStopGoalExecution(goal({ state: "PAUSED" }))).toBe(true)
    expect(shouldStopGoalExecution(goal({ state: "BLOCKED" }))).toBe(true)
    expect(shouldStopGoalExecution(goal({ state: "FAILED" }))).toBe(true)
    expect(shouldStopGoalExecution(goal({ state: "CANCELLED" }))).toBe(true)
    expect(shouldStopGoalExecution(goal({ state: "COMPLETED" }))).toBe(true)
    expect(shouldStopGoalExecution(goal({ state: "BUDGET_EXCEEDED" }))).toBe(true)
    expect(shouldStopGoalExecution(goal({ state: "ACTIVE" }))).toBe(false)
    expect(shouldStopGoalExecution(goal({ state: "VERIFYING" }))).toBe(false)
  })

  test("execution loop stops immediately when goal is paused", async () => {
    const result = await runGoalExecutionLoop({
      goal: goal({ state: "PAUSED" }),
      plan: plan([step({ id: "inspect" })]),
      maxIterations: 5,
    })

    expect(result).toEqual({ iterations: 0, reason: "STOPPED_STATE", selectedStep: undefined })
  })

  test("execution loop selects the next step without executing tools", async () => {
    const result = await runGoalExecutionLoop({
      goal: goal(),
      plan: plan([step({ id: "inspect" })]),
      maxIterations: 5,
    })

    expect(result).toEqual({ iterations: 1, reason: "STEP_READY", selectedStep: "inspect" })
  })

  test("execution loop stops when no actionable step exists", async () => {
    const result = await runGoalExecutionLoop({
      goal: goal(),
      plan: plan([step({ id: "inspect", status: "COMPLETED" })]),
      maxIterations: 5,
    })

    expect(result).toEqual({ iterations: 0, reason: "NO_ACTIONABLE_STEP", selectedStep: undefined })
  })

  test("execution loop enforces max iteration guard", async () => {
    const result = await runGoalExecutionLoop({
      goal: goal(),
      plan: plan([step({ id: "inspect" })]),
      maxIterations: 0,
    })

    expect(result).toEqual({ iterations: 0, reason: "MAX_ITERATIONS", selectedStep: undefined })
  })
})
