import { describe, expect, test } from "bun:test"
import {
  renderGoalBudget,
  renderGoalCleared,
  renderGoalHistory,
  renderGoalLogs,
  renderGoalPaused,
  renderGoalResumed,
  renderGoalStatus,
  renderNoActiveGoal,
} from "@/goal/renderer"
import type { Goal, GoalPlan } from "@/goal/types"

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal_123",
    title: "Migrate repository to Bun",
    objective: "Migrate the repository to Bun and verify package checks pass.",
    state: "ACTIVE",
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:01.000Z",
    currentStepId: "step_1",
    progress: {
      totalSteps: 2,
      completedSteps: 1,
      failedSteps: 0,
      blockedSteps: 0,
      percentComplete: 50,
    },
    budget: {
      usedTokens: 100,
      maxTokens: 1000,
      usedRuntimeMs: 60_000,
      maxRuntimeMs: 600_000,
      usedSteps: 1,
      maxSteps: 10,
      usedCostUsd: 0.05,
      maxCostUsd: 1,
    },
    ...overrides,
  }
}

function plan(): GoalPlan {
  return {
    id: "plan_123",
    goalId: "goal_123",
    version: 1,
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:01.000Z",
    steps: [
      {
        id: "step_1",
        title: "Run typecheck",
        description: "Verify package typecheck passes.",
        status: "ACTIVE",
        dependencies: [],
        verification: [],
      },
    ],
  }
}

describe("goal renderer", () => {
  test("renders no active goal message", () => {
    expect(renderNoActiveGoal()).toContain("No active goal")
    expect(renderNoActiveGoal()).toContain("/goal <objective>")
  })

  test("renders active goal status with progress, current step, and budget", () => {
    const output = renderGoalStatus({ goal: goal(), plan: plan() })

    expect(output).toContain("GOAL")
    expect(output).toContain("Migrate repository to Bun")
    expect(output).toContain("State: ACTIVE")
    expect(output).toContain("Progress: 1 / 2 steps complete")
    expect(output).toContain("Current Step: Run typecheck")
    expect(output).toContain("Steps: 1 / 10")
    expect(output).toContain("Tokens: 100 / 1000")
  })

  test("renders archived goal history newest first", () => {
    const output = renderGoalHistory([
      goal({ id: "goal_new", title: "New goal", state: "COMPLETED", updatedAt: "2026-06-17T00:00:02.000Z" }),
      goal({ id: "goal_old", title: "Old goal", state: "CANCELLED", updatedAt: "2026-06-17T00:00:00.000Z" }),
    ])

    expect(output).toContain("GOAL HISTORY")
    expect(output).toContain("2026-06-17T00:00:02.000Z COMPLETED goal_new New goal")
    expect(output).toContain("2026-06-17T00:00:00.000Z CANCELLED goal_old Old goal")
  })

  test("renders empty goal history", () => {
    expect(renderGoalHistory([])).toContain("No archived goals")
  })

  test("renders goal logs chronologically", () => {
    const output = renderGoalLogs([
      {
        id: "event_1",
        goalId: "goal_123",
        type: "GOAL_CREATED",
        message: "Goal created",
        createdAt: "2026-06-17T00:00:00.000Z",
      },
      {
        id: "event_2",
        goalId: "goal_123",
        type: "STATE_CHANGED",
        message: "Goal moved to planning",
        createdAt: "2026-06-17T00:00:01.000Z",
      },
    ])

    expect(output).toContain("GOAL LOGS")
    expect(output).toContain("2026-06-17T00:00:00.000Z GOAL_CREATED Goal created")
    expect(output).toContain("2026-06-17T00:00:01.000Z STATE_CHANGED Goal moved to planning")
  })

  test("renders empty goal logs", () => {
    expect(renderGoalLogs([])).toContain("No goal events")
  })

  test("renders budget details", () => {
    const output = renderGoalBudget(goal())

    expect(output).toContain("Budget")
    expect(output).toContain("Steps: 1 / 10")
    expect(output).toContain("Runtime: 60000 / 600000")
  })

  test("renders pause confirmation", () => {
    const output = renderGoalPaused(goal({ state: "PAUSED" }))

    expect(output).toContain("Goal paused")
    expect(output).toContain("goal_123")
  })

  test("renders resume confirmation", () => {
    const output = renderGoalResumed(goal({ state: "ACTIVE" }))

    expect(output).toContain("Goal resumed")
    expect(output).toContain("goal_123")
  })

  test("renders clear/archive confirmation", () => {
    const output = renderGoalCleared(goal({ state: "CANCELLED" }))

    expect(output).toContain("Goal cancelled and archived")
    expect(output).toContain("goal_123")
  })
})
