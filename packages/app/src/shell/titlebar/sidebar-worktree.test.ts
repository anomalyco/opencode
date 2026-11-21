import { describe, expect, test } from "bun:test"
import type { WorktreeDirectory } from "@opencode/client/promise"
import type { Project } from "@/runtime/server/types"
import { worktreeBadge } from "./sidebar-worktree"

const fixture = (overrides: Partial<Project> = {}) =>
  ({
    id: "fixture",
    worktree: "/repo",
    sandboxes: [],
    worktrees: [],
    ...overrides,
  }) as unknown as Project

const worktree = (directory: string, strategy?: string) => ({ directory, strategy }) as WorktreeDirectory

describe("worktreeBadge", () => {
  test("returns nothing for a project without worktrees", () => {
    expect(worktreeBadge("/repo", fixture(), "Local")).toBeUndefined()
    expect(worktreeBadge(undefined, fixture(), "Local")).toBeUndefined()
    expect(worktreeBadge("/repo", undefined, "Local")).toBeUndefined()
  })

  test("labels the root checkout as local, including subdirectories", () => {
    const project = fixture({ sandboxes: ["/repo-qa"] })

    expect(worktreeBadge("/repo", project, "Local")?.label).toBe("Local")
    expect(worktreeBadge("/repo/packages/app", project, "Local")?.label).toBe("Local")
  })

  test("labels a worktree by its directory, including subdirectories", () => {
    const project = fixture({ sandboxes: ["/repo-qa", "/repo-cake5"] })

    expect(worktreeBadge("/repo-qa", project, "Local")?.label).toBe("qa")
    expect(worktreeBadge("/repo-qa/src", project, "Local")?.label).toBe("qa")
    expect(worktreeBadge("/repo-cake5", project, "Local")?.label).toBe("cake5")
  })

  test("includes plain git worktrees that are not in the sandbox list", () => {
    const project = fixture({ worktrees: [worktree("/repo-plain")] })

    expect(worktreeBadge("/repo-plain", project, "Local")?.label).toBe("plain")
  })

  test("uses the longest containing worktree", () => {
    const project = fixture({
      sandboxes: ["/repo-qa"],
      worktrees: [worktree("/repo-qa/packages", "git")],
    })

    expect(worktreeBadge("/repo-qa/packages/app", project, "Local")?.label).toBe("packages")
  })

  test("handles Windows paths", () => {
    const project = fixture({
      worktree: "C:\\repo",
      sandboxes: ["C:\\repo-qa"],
    })

    expect(worktreeBadge("C:\\repo-qa\\src", project, "Local")?.label).toBe("qa")
  })

  test("derives the color from the worktree, not the session directory", () => {
    const project = fixture({ sandboxes: ["/repo-qa"] })
    const root = worktreeBadge("/repo-qa", project, "Local")
    const nested = worktreeBadge("/repo-qa/src", project, "Local")

    expect(root?.color).toMatch(/^hsl\(/)
    expect(nested?.color).toBe(root?.color)
  })
})
