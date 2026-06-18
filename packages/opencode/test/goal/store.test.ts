import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { MalformedGoalStateError } from "@/goal/errors"
import { archiveActiveGoal, listArchivedGoals, loadActiveGoal, saveActiveGoal } from "@/goal/store"
import type { Goal, GoalPlan } from "@/goal/types"
import type { InstanceContext } from "@/project/instance-context"
import { tmpdir } from "../fixture/fixture"

function context(root: string): Pick<InstanceContext, "directory" | "worktree"> {
  return {
    directory: path.join(root, "packages", "opencode"),
    worktree: root,
  }
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal_123",
    title: "Migrate repository to Bun",
    objective: "Migrate the repository to Bun and verify package checks pass.",
    state: "CREATED",
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
    },
    ...overrides,
  }
}

function plan(goalId = "goal_123"): GoalPlan {
  return {
    id: "plan_123",
    goalId,
    version: 1,
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
    steps: [],
  }
}

describe("goal store", () => {
  test("saves and loads active goal and plan under worktree-local state", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    const expectedGoal = goal()
    const expectedPlan = plan()

    await saveActiveGoal(ctx, { goal: expectedGoal, plan: expectedPlan })

    const loaded = await loadActiveGoal(ctx)
    expect(loaded?.goal).toEqual(expectedGoal)
    expect(loaded?.plan).toEqual(expectedPlan)
  })

  test("returns null when no active goal exists", async () => {
    await using tmp = await tmpdir()
    const loaded = await loadActiveGoal(context(tmp.path))

    expect(loaded).toBeNull()
  })

  test("throws malformed state error for invalid active goal json", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    const active = path.join(tmp.path, ".opencode", "goals", "active")
    await fs.mkdir(active, { recursive: true })
    await fs.writeFile(path.join(active, "goal.json"), "{ invalid json", "utf8")

    let error: unknown
    try {
      await loadActiveGoal(ctx)
    } catch (cause) {
      error = cause
    }

    expect(error).toBeInstanceOf(MalformedGoalStateError)
  })

  test("lists archived goals newest first and skips malformed archives", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)

    await saveActiveGoal(ctx, {
      goal: goal({ id: "goal_old", title: "Old goal", updatedAt: "2026-06-17T00:00:00.000Z" }),
      plan: plan("goal_old"),
    })
    await archiveActiveGoal(ctx)

    await saveActiveGoal(ctx, {
      goal: goal({ id: "goal_new", title: "New goal", updatedAt: "2026-06-17T00:00:02.000Z" }),
      plan: plan("goal_new"),
    })
    await archiveActiveGoal(ctx)

    const malformed = path.join(tmp.path, ".opencode", "goals", "history", "goal_bad")
    await fs.mkdir(malformed, { recursive: true })
    await fs.writeFile(path.join(malformed, "goal.json"), "{ invalid json", "utf8")

    const archived = await listArchivedGoals(ctx)

    expect(archived.map((item) => item.id)).toEqual(["goal_new", "goal_old"])
  })

  test("returns empty archived goal list when history directory does not exist", async () => {
    await using tmp = await tmpdir()

    expect(await listArchivedGoals(context(tmp.path))).toEqual([])
  })

  test("archives active goal assets into history and clears active state", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    const expectedGoal = goal({ state: "CANCELLED" })
    const expectedPlan = plan()

    await saveActiveGoal(ctx, { goal: expectedGoal, plan: expectedPlan })

    const active = path.join(tmp.path, ".opencode", "goals", "active")
    await fs.writeFile(path.join(active, "events.jsonl"), JSON.stringify({ type: "GOAL_CANCELLED" }) + "\n", "utf8")
    await fs.writeFile(path.join(active, "evidence.jsonl"), JSON.stringify({ type: "COMMAND", passed: true }) + "\n", "utf8")
    await fs.mkdir(path.join(active, "checkpoints"), { recursive: true })
    await fs.writeFile(path.join(active, "checkpoints", "001.json"), JSON.stringify({ goalId: expectedGoal.id }), "utf8")

    const archived = await archiveActiveGoal(ctx)

    expect(archived.goal.id).toBe(expectedGoal.id)
    expect(await loadActiveGoal(ctx)).toBeNull()

    const history = path.join(tmp.path, ".opencode", "goals", "history", expectedGoal.id)
    expect(await Bun.file(path.join(history, "goal.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(history, "plan.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(history, "events.jsonl")).exists()).toBe(true)
    expect(await Bun.file(path.join(history, "evidence.jsonl")).exists()).toBe(true)
    expect(await Bun.file(path.join(history, "checkpoints", "001.json")).exists()).toBe(true)
  })
})
