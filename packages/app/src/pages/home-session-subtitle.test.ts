import { describe, expect, test } from "bun:test"
import { homeSessionSubtitle } from "./home-session-subtitle"

describe("homeSessionSubtitle", () => {
  test("uses the project name for the main worktree", () => {
    expect(
      homeSessionSubtitle({
        projectName: "opencode-fork-worktree-e2e",
        projectWorktree: "/tmp/opencode-fork-worktree-e2e",
        sessionDirectory: "/tmp/opencode-fork-worktree-e2e",
      }),
    ).toBe("opencode-fork-worktree-e2e")
  })

  test("includes the branch for a fork worktree session", () => {
    expect(
      homeSessionSubtitle({
        projectName: "opencode-fork-worktree-e2e",
        projectWorktree: "/tmp/opencode-fork-worktree-e2e",
        sessionDirectory: "/tmp/opencode-worktrees/clever-garden",
        branch: "opencode/clever-garden",
      }),
    ).toBe("opencode-fork-worktree-e2e - opencode/clever-garden")
  })

  test("falls back to the directory name while worktree branch data is loading", () => {
    expect(
      homeSessionSubtitle({
        projectName: "opencode-fork-worktree-e2e",
        projectWorktree: "/tmp/opencode-fork-worktree-e2e",
        sessionDirectory: "/tmp/opencode-worktrees/clever-garden",
      }),
    ).toBe("opencode-fork-worktree-e2e - clever-garden")
  })
})
