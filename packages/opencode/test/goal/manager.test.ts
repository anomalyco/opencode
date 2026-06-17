import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ActiveGoalExistsError, InvalidGoalTransitionError, NoActiveGoalError } from "@/goal/errors"
import { createGoalManager } from "@/goal/manager"
import { loadActiveGoal, saveActiveGoal } from "@/goal/store"
import type { InstanceContext } from "@/project/instance-context"
import { tmpdir } from "../fixture/fixture"

function context(root: string): Pick<InstanceContext, "directory" | "worktree"> {
  return {
    directory: path.join(root, "packages", "opencode"),
    worktree: root,
  }
}

function manager(ctx: Pick<InstanceContext, "directory" | "worktree">) {
  return createGoalManager(ctx, {
    now: () => "2026-06-17T00:00:00.000Z",
    id: () => "goal_123",
    checkpointId: () => "checkpoint_001",
  })
}

describe("goal manager", () => {
  test("init detects active goal without resuming or mutating state", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    const mgr = manager(ctx)

    const created = await mgr.create("Migrate repository to Bun")
    const initialized = await mgr.init()

    expect(initialized?.goal).toEqual(created)
    expect(initialized?.goal.state).toBe("CREATED")
  })

  test("creates and persists an active goal", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    const mgr = manager(ctx)

    const created = await mgr.create("Migrate repository to Bun")

    expect(created).toMatchObject({
      id: "goal_123",
      title: "Migrate repository to Bun",
      objective: "Migrate repository to Bun",
      state: "CREATED",
    })
    const active = await loadActiveGoal(ctx)
    expect(active).toMatchObject({ goal: created })
    expect(active?.plan).toMatchObject({ goalId: created.id, version: 1 })
  })

  test("rejects duplicate active goal creation", async () => {
    await using tmp = await tmpdir()
    const mgr = manager(context(tmp.path))

    await mgr.create("First goal")

    let error: unknown
    try {
      await mgr.create("Second goal")
    } catch (cause) {
      error = cause
    }

    expect(error).toBeInstanceOf(ActiveGoalExistsError)
  })

  test("returns no-active status when no goal exists", async () => {
    await using tmp = await tmpdir()
    const status = await manager(context(tmp.path)).status()

    expect(status.active).toBeNull()
    expect(status.output).toContain("No active goal")
  })

  test("returns active goal logs output", async () => {
    await using tmp = await tmpdir()
    const mgr = manager(context(tmp.path))

    await mgr.create("Migrate repository to Bun")
    const logs = await mgr.logs()

    expect(logs.events.map((event) => event.type)).toContain("GOAL_CREATED")
    expect(logs.output).toContain("GOAL LOGS")
    expect(logs.output).toContain("GOAL_CREATED")
  })

  test("returns empty logs output when no active goal exists", async () => {
    await using tmp = await tmpdir()
    const logs = await manager(context(tmp.path)).logs()

    expect(logs.events).toEqual([])
    expect(logs.output).toContain("No goal events")
  })

  test("returns active status output for current goal", async () => {
    await using tmp = await tmpdir()
    const mgr = manager(context(tmp.path))

    await mgr.create("Migrate repository to Bun")
    const status = await mgr.status()

    expect(status.active?.goal.title).toBe("Migrate repository to Bun")
    expect(status.output).toContain("State: CREATED")
  })

  test("pause transitions active goal to paused, emits event, checkpoints, and persists state", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    const mgr = manager(ctx)

    const created = await mgr.create("Migrate repository to Bun")
    const active = await loadActiveGoal(ctx)
    await saveActiveGoal(ctx, { goal: { ...created, state: "ACTIVE" }, plan: active?.plan })

    const paused = await mgr.pause()

    expect(paused.state).toBe("PAUSED")
    expect((await loadActiveGoal(ctx))?.goal.state).toBe("PAUSED")

    const activePath = path.join(tmp.path, ".opencode", "goals", "active")
    const events = await fs.readFile(path.join(activePath, "events.jsonl"), "utf8")
    const checkpointExists = await Bun.file(path.join(activePath, "checkpoints", "checkpoint_001.json")).exists()

    expect(events).toContain("GOAL_PAUSED")
    expect(checkpointExists).toBe(true)
  })

  test("resume transitions paused goal to active, emits event, checkpoints, and persists state", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    const mgr = manager(ctx)

    const created = await mgr.create("Migrate repository to Bun")
    const active = await loadActiveGoal(ctx)
    await saveActiveGoal(ctx, { goal: { ...created, state: "ACTIVE" }, plan: active?.plan })

    await mgr.pause()
    const resumed = await mgr.resume()

    expect(resumed.state).toBe("ACTIVE")
    expect((await loadActiveGoal(ctx))?.goal.state).toBe("ACTIVE")

    const activePath = path.join(tmp.path, ".opencode", "goals", "active")
    const events = await fs.readFile(path.join(activePath, "events.jsonl"), "utf8")
    const checkpointExists = await Bun.file(path.join(activePath, "checkpoints", "checkpoint_001.json")).exists()

    expect(events).toContain("GOAL_RESUMED")
    expect(checkpointExists).toBe(true)
  })

  test("pause and resume fail when no active goal exists", async () => {
    await using tmp = await tmpdir()
    const mgr = manager(context(tmp.path))

    let pauseError: unknown
    try {
      await mgr.pause()
    } catch (cause) {
      pauseError = cause
    }

    let resumeError: unknown
    try {
      await mgr.resume()
    } catch (cause) {
      resumeError = cause
    }

    expect(pauseError).toBeInstanceOf(NoActiveGoalError)
    expect(resumeError).toBeInstanceOf(NoActiveGoalError)
  })

  test("marks active goal as budget exceeded when budget is over limit", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    const mgr = manager(ctx)

    const created = await mgr.create("Migrate repository to Bun")
    const active = await loadActiveGoal(ctx)
    await saveActiveGoal(ctx, {
      goal: {
        ...created,
        state: "ACTIVE",
        budget: { ...created.budget, usedSteps: 2, maxSteps: 1 },
      },
      plan: active?.plan,
    })

    const exceeded = await mgr.enforceBudget()

    expect(exceeded.state).toBe("BUDGET_EXCEEDED")
    expect((await loadActiveGoal(ctx))?.goal.state).toBe("BUDGET_EXCEEDED")

    const activePath = path.join(tmp.path, ".opencode", "goals", "active")
    const events = await fs.readFile(path.join(activePath, "events.jsonl"), "utf8")
    const checkpointExists = await Bun.file(path.join(activePath, "checkpoints", "checkpoint_001.json")).exists()

    expect(events).toContain("BUDGET_EXCEEDED")
    expect(checkpointExists).toBe(true)
  })

  test("resume rejects invalid transitions", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    const mgr = manager(ctx)

    await mgr.create("Migrate repository to Bun")

    let error: unknown
    try {
      await mgr.resume()
    } catch (cause) {
      error = cause
    }

    expect(error).toBeInstanceOf(InvalidGoalTransitionError)
  })

  test("clear cancels, checkpoints, emits events, archives, and clears active state", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    const mgr = manager(ctx)

    const created = await mgr.create("Migrate repository to Bun")
    const cleared = await mgr.clear()

    expect(cleared.state).toBe("CANCELLED")
    expect(await loadActiveGoal(ctx)).toBeNull()

    const history = path.join(tmp.path, ".opencode", "goals", "history", created.id)
    const archivedGoal = await Bun.file(path.join(history, "goal.json")).json()
    const events = await fs.readFile(path.join(history, "events.jsonl"), "utf8")
    const checkpointExists = await Bun.file(path.join(history, "checkpoints", "checkpoint_001.json")).exists()

    expect(archivedGoal.state).toBe("CANCELLED")
    expect(events).toContain("GOAL_CREATED")
    expect(events).toContain("GOAL_CANCELLED")
    expect(checkpointExists).toBe(true)
  })
})
