import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { appendGoalEvidence, readGoalEvidence } from "@/goal/evidence"
import type { FileEvidence } from "@/goal/types"
import type { InstanceContext } from "@/project/instance-context"
import { tmpdir } from "../fixture/fixture"

function context(root: string): Pick<InstanceContext, "directory" | "worktree"> {
  return {
    directory: path.join(root, "packages", "opencode"),
    worktree: root,
  }
}

describe("goal evidence", () => {
  test("appends and reads evidence chronologically", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    const first: FileEvidence = {
      id: "evidence_1",
      goalId: "goal_123",
      stepId: "step_1",
      type: "FILE_EXISTS",
      path: "README.md",
      observed: true,
      passed: true,
      createdAt: "2026-06-17T00:00:00.000Z",
    }
    const second: FileEvidence = {
      id: "evidence_2",
      goalId: "goal_123",
      stepId: "step_2",
      type: "FILE_CONTAINS",
      path: "README.md",
      expected: "OpenCode",
      observed: "OpenCode",
      passed: true,
      createdAt: "2026-06-17T00:00:01.000Z",
    }

    await appendGoalEvidence(ctx, first)
    await appendGoalEvidence(ctx, second)

    expect(await readGoalEvidence(ctx)).toEqual([first, second])
  })

  test("returns empty list when evidence log does not exist", async () => {
    await using tmp = await tmpdir()

    expect(await readGoalEvidence(context(tmp.path))).toEqual([])
  })

  test("skips malformed evidence lines without discarding valid previous evidence", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    const valid: FileEvidence = {
      id: "evidence_1",
      goalId: "goal_123",
      type: "FILE_EXISTS",
      path: "README.md",
      observed: true,
      passed: true,
      createdAt: "2026-06-17T00:00:00.000Z",
    }

    await appendGoalEvidence(ctx, valid)
    await fs.appendFile(path.join(tmp.path, ".opencode", "goals", "active", "evidence.jsonl"), "{ invalid json\n")

    expect(await readGoalEvidence(ctx)).toEqual([valid])
  })
})
