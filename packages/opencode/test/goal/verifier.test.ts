import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { readGoalEvidence } from "@/goal/evidence"
import { verifyRequirement } from "@/goal/verifier"
import type { InstanceContext } from "@/project/instance-context"
import { tmpdir } from "../fixture/fixture"

function context(root: string): Pick<InstanceContext, "directory" | "worktree"> {
  return {
    directory: root,
    worktree: root,
  }
}

describe("goal verifier", () => {
  test("passes FILE_EXISTS verification when file exists and persists evidence", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    await fs.writeFile(path.join(tmp.path, "README.md"), "# OpenCode\n", "utf8")

    const evidence = await verifyRequirement(ctx, {
      id: "evidence_1",
      goalId: "goal_123",
      requirement: { type: "FILE_EXISTS", path: "README.md" },
      createdAt: "2026-06-17T00:00:00.000Z",
    })

    expect(evidence).toMatchObject({ type: "FILE_EXISTS", path: "README.md", observed: true, passed: true })
    expect(await readGoalEvidence(ctx)).toEqual([evidence])
  })

  test("fails FILE_EXISTS verification when file is missing and persists evidence", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)

    const evidence = await verifyRequirement(ctx, {
      id: "evidence_1",
      goalId: "goal_123",
      requirement: { type: "FILE_EXISTS", path: "missing.md" },
      createdAt: "2026-06-17T00:00:00.000Z",
    })

    expect(evidence).toMatchObject({ type: "FILE_EXISTS", path: "missing.md", observed: false, passed: false })
    expect(await readGoalEvidence(ctx)).toEqual([evidence])
  })

  test("passes FILE_CONTAINS verification when file contains pattern", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    await fs.writeFile(path.join(tmp.path, "README.md"), "# OpenCode\nNative goal support\n", "utf8")

    const evidence = await verifyRequirement(ctx, {
      id: "evidence_1",
      goalId: "goal_123",
      stepId: "step_1",
      requirement: { type: "FILE_CONTAINS", path: "README.md", pattern: "Native goal" },
      createdAt: "2026-06-17T00:00:00.000Z",
    })

    expect(evidence).toMatchObject({
      type: "FILE_CONTAINS",
      path: "README.md",
      expected: "Native goal",
      observed: "Native goal",
      passed: true,
      stepId: "step_1",
    })
  })

  test("fails FILE_CONTAINS verification when pattern is missing", async () => {
    await using tmp = await tmpdir()
    const ctx = context(tmp.path)
    await fs.writeFile(path.join(tmp.path, "README.md"), "# OpenCode\n", "utf8")

    const evidence = await verifyRequirement(ctx, {
      id: "evidence_1",
      goalId: "goal_123",
      requirement: { type: "FILE_CONTAINS", path: "README.md", pattern: "Native goal" },
      createdAt: "2026-06-17T00:00:00.000Z",
    })

    expect(evidence).toMatchObject({
      type: "FILE_CONTAINS",
      path: "README.md",
      expected: "Native goal",
      observed: false,
      passed: false,
    })
  })
})
