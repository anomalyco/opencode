import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ActiveGoalExistsError } from "@/goal/errors"
import { createGoalManager } from "@/goal/manager"
import { loadActiveGoal } from "@/goal/store"
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

  test("returns active status output for current goal", async () => {
    await using tmp = await tmpdir()
    const mgr = manager(context(tmp.path))

    await mgr.create("Migrate repository to Bun")
    const status = await mgr.status()

    expect(status.active?.goal.title).toBe("Migrate repository to Bun")
    expect(status.output).toContain("State: CREATED")
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
