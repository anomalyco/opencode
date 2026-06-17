import { describe, expect, test } from "bun:test"
import { createDeterministicGoalPlan } from "@/goal/planner"
import type { Goal } from "@/goal/types"

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal_123",
    title: "Migrate repository to Bun",
    objective: "Migrate repository to Bun and verify package checks pass.",
    state: "CREATED",
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
    progress: {
      totalSteps: 0,
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
    },
    ...overrides,
  }
}

describe("goal planner", () => {
  test("creates a deterministic MVP plan for a goal", () => {
    const plan = createDeterministicGoalPlan(goal(), {
      id: "plan_123",
      now: "2026-06-17T00:00:01.000Z",
    })

    expect(plan).toMatchObject({
      id: "plan_123",
      goalId: "goal_123",
      version: 1,
      createdAt: "2026-06-17T00:00:01.000Z",
      updatedAt: "2026-06-17T00:00:01.000Z",
    })
    expect(plan.steps.map((step) => step.title)).toEqual([
      "Inspect project context",
      "Design implementation approach",
      "Apply implementation changes",
      "Run verification",
      "Summarize result",
    ])
  })

  test("creates ordered pending steps with stable dependencies", () => {
    const plan = createDeterministicGoalPlan(goal(), {
      id: "plan_123",
      now: "2026-06-17T00:00:01.000Z",
    })

    expect(plan.steps.map((step) => step.status)).toEqual(["PENDING", "PENDING", "PENDING", "PENDING", "PENDING"])
    expect(plan.steps.map((step) => step.dependencies)).toEqual([[], ["inspect"], ["design"], ["implement"], ["verify"]])
  })

  test("includes command verification for the verification step", () => {
    const plan = createDeterministicGoalPlan(goal(), {
      id: "plan_123",
      now: "2026-06-17T00:00:01.000Z",
    })

    const verify = plan.steps.find((step) => step.id === "verify")
    expect(verify?.verification).toEqual([
      {
        type: "COMMAND",
        command: "bun run --cwd packages/opencode typecheck",
        expectedExitCode: 0,
      },
    ])
  })
})
