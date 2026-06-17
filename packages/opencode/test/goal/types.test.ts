import { describe, expect, test } from "bun:test"
import type {
  CommandEvidence,
  Goal,
  GoalBudget,
  GoalPlan,
  GoalProgress,
  GoalState,
  VerificationRequirement,
} from "@/goal/types"

describe("goal types", () => {
  test("constructs a persisted goal fixture", () => {
    const state: GoalState = "CREATED"
    const progress: GoalProgress = {
      totalSteps: 2,
      completedSteps: 0,
      failedSteps: 0,
      blockedSteps: 0,
      percentComplete: 0,
    }
    const budget: GoalBudget = {
      usedTokens: 0,
      usedRuntimeMs: 0,
      usedSteps: 0,
      usedCostUsd: 0,
      maxSteps: 50,
    }
    const goal: Goal = {
      id: "goal_123",
      title: "Migrate repository to Bun",
      objective: "Migrate the repository to Bun and verify package checks pass.",
      state,
      createdAt: "2026-06-17T00:00:00.000Z",
      updatedAt: "2026-06-17T00:00:00.000Z",
      progress,
      budget,
    }

    expect(goal.state).toBe("CREATED")
    expect(goal.progress.totalSteps).toBe(2)
    expect(goal.budget.maxSteps).toBe(50)
  })

  test("constructs a plan with command verification requirements", () => {
    const verification: VerificationRequirement = {
      type: "COMMAND",
      command: "bun run --cwd packages/opencode typecheck",
      expectedExitCode: 0,
    }
    const plan: GoalPlan = {
      id: "plan_123",
      goalId: "goal_123",
      version: 1,
      createdAt: "2026-06-17T00:00:00.000Z",
      updatedAt: "2026-06-17T00:00:00.000Z",
      steps: [
        {
          id: "step_1",
          title: "Run package typecheck",
          description: "Verify the OpenCode package typechecks.",
          status: "PENDING",
          dependencies: [],
          verification: [verification],
        },
      ],
    }

    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]?.verification[0]).toEqual(verification)
  })

  test("constructs command evidence for verification gating", () => {
    const evidence: CommandEvidence = {
      id: "evidence_123",
      type: "COMMAND",
      goalId: "goal_123",
      stepId: "step_1",
      command: "bun run --cwd packages/opencode typecheck",
      cwd: "/repo",
      expectedExitCode: 0,
      exitCode: 0,
      output: "$ tsgo --noEmit",
      truncated: false,
      timedOut: false,
      aborted: false,
      passed: true,
      startedAt: "2026-06-17T00:00:00.000Z",
      completedAt: "2026-06-17T00:00:01.000Z",
      createdAt: "2026-06-17T00:00:01.000Z",
    }

    expect(evidence.passed).toBe(true)
    expect(evidence.exitCode).toBe(evidence.expectedExitCode)
  })
})
