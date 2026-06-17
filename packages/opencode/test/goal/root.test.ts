import { describe, expect, test } from "bun:test"
import path from "path"
import { goalPaths, goalRoot } from "@/goal/root"
import type { InstanceContext } from "@/project/instance-context"

function context(input: Pick<InstanceContext, "directory" | "worktree">): Pick<InstanceContext, "directory" | "worktree"> {
  return {
    directory: input.directory,
    worktree: input.worktree,
  }
}

describe("goal root", () => {
  test("uses worktree root when worktree is available", () => {
    const ctx = context({ directory: "/repo/packages/opencode", worktree: "/repo" })

    expect(goalRoot(ctx)).toBe(path.normalize("/repo"))
  })

  test("falls back to directory when worktree is filesystem root", () => {
    const ctx = context({ directory: "/tmp/no-git-project", worktree: "/" })

    expect(goalRoot(ctx)).toBe(path.normalize("/tmp/no-git-project"))
  })

  test("builds normalized goal storage paths", () => {
    const ctx = context({ directory: "/repo/packages/opencode", worktree: "/repo" })
    const paths = goalPaths(ctx)

    expect(paths.root).toBe(path.normalize("/repo"))
    expect(paths.goals).toBe(path.join(path.normalize("/repo"), ".opencode", "goals"))
    expect(paths.active).toBe(path.join(path.normalize("/repo"), ".opencode", "goals", "active"))
    expect(paths.history).toBe(path.join(path.normalize("/repo"), ".opencode", "goals", "history"))
    expect(paths.activeGoal).toBe(path.join(path.normalize("/repo"), ".opencode", "goals", "active", "goal.json"))
    expect(paths.activePlan).toBe(path.join(path.normalize("/repo"), ".opencode", "goals", "active", "plan.json"))
    expect(paths.activeEvents).toBe(path.join(path.normalize("/repo"), ".opencode", "goals", "active", "events.jsonl"))
    expect(paths.activeEvidence).toBe(path.join(path.normalize("/repo"), ".opencode", "goals", "active", "evidence.jsonl"))
    expect(paths.activeCheckpoints).toBe(path.join(path.normalize("/repo"), ".opencode", "goals", "active", "checkpoints"))
  })
})
