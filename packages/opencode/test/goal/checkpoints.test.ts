import { describe, expect, test } from "bun:test"
import path from "path"
import { createGoalCheckpoint, listGoalCheckpoints } from "@/goal/checkpoints"
import type { Goal, GoalPlan } from "@/goal/types"
import type { InstanceContext } from "@/project/instance-context"
import { tmpdir } from "../fixture/fixture"

function context(root: string): Pick<InstanceContext, "directory" | "worktree"> {
  return {
    directory: path.join(root, "packages", "opencode"),
    worktree: root,
  }
}

function goal(): Goal {
  return {
    id: "goal_123",
    title: "Migrate repository to Bun",
    objective: "Migrate the repository to Bun and verify package checks pass.",
    state: "PLANNING",
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:01.000Z",
    currentStepId: "step_1",
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
    },
  }
}

function plan(): GoalPlan {
  return {
    id: "plan_123",
    goalId: "goal_123",
    version: 1,
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:01.000Z",
    steps: [],
  }
}

describe("goal checkpoints", () => {
  test("creates checkpoint snapshots with goal and plan state", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    const expectedGoal = goal()
    const expectedPlan = plan()

    const checkpoint = await createGoalCheckpoint(ctx, {
      id: "checkpoint_001",
      goal: expectedGoal,
      plan: expectedPlan,
      createdAt: "2026-06-17T00:00:02.000Z",
    })

    expect(checkpoint).toEqual({
      id: "checkpoint_001",
      goalId: expectedGoal.id,
      state: "PLANNING",
      currentStepId: "step_1",
      goalSnapshot: expectedGoal,
      planSnapshot: expectedPlan,
      createdAt: "2026-06-17T00:00:02.000Z",
    })

    const checkpoints = await listGoalCheckpoints(ctx)
    expect(checkpoints).toEqual([checkpoint])
  })

  test("returns checkpoints sorted by filename", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)

    const second = await createGoalCheckpoint(ctx, {
      id: "checkpoint_002",
      goal: goal(),
      createdAt: "2026-06-17T00:00:02.000Z",
    })
    const first = await createGoalCheckpoint(ctx, {
      id: "checkpoint_001",
      goal: goal(),
      createdAt: "2026-06-17T00:00:01.000Z",
    })

    expect(await listGoalCheckpoints(ctx)).toEqual([first, second])
  })

  test("returns empty list when checkpoint directory does not exist", async () => {
    await using tmp = await tmpdir()

    expect(await listGoalCheckpoints(context(tmp.path))).toEqual([])
  })
})
