import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { appendGoalEvent, readGoalEvents } from "@/goal/events"
import type { GoalEvent } from "@/goal/types"
import type { InstanceContext } from "@/project/instance-context"
import { tmpdir } from "../fixture/fixture"

function context(root: string): InstanceContext {
  return {
    directory: path.join(root, "packages", "opencode"),
    worktree: root,
    project: {
      id: "project_123",
      time: { created: 0, updated: 0 },
    } as InstanceContext["project"],
  }
}

describe("goal events", () => {
  test("appends and reads goal events chronologically", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)

    const first: GoalEvent = {
      id: "event_1",
      goalId: "goal_123",
      type: "GOAL_CREATED",
      message: "Goal created",
      createdAt: "2026-06-17T00:00:00.000Z",
    }
    const second: GoalEvent = {
      id: "event_2",
      goalId: "goal_123",
      type: "STATE_CHANGED",
      message: "Goal moved to planning",
      metadata: { from: "CREATED", to: "PLANNING" },
      createdAt: "2026-06-17T00:00:01.000Z",
    }

    await appendGoalEvent(ctx, first)
    await appendGoalEvent(ctx, second)

    expect(await readGoalEvents(ctx)).toEqual([first, second])
  })

  test("returns empty list when event log does not exist", async () => {
    await using tmp = await tmpdir()

    expect(await readGoalEvents(context(tmp.path))).toEqual([])
  })

  test("skips malformed event lines without discarding valid previous events", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    const valid: GoalEvent = {
      id: "event_1",
      goalId: "goal_123",
      type: "GOAL_CREATED",
      message: "Goal created",
      createdAt: "2026-06-17T00:00:00.000Z",
    }

    await appendGoalEvent(ctx, valid)
    await fs.appendFile(path.join(tmp.path, ".opencode", "goals", "active", "events.jsonl"), "{ invalid json\n")

    expect(await readGoalEvents(ctx)).toEqual([valid])
  })
})
