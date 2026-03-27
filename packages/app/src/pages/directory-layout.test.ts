import { describe, expect, test } from "bun:test"
import { projectRoot, syncProject } from "./directory-layout-sync"

describe("directory layout project registration", () => {
  test("resolves a git worktree root", () => {
    expect(projectRoot("/repo/worktree", "/repo")).toBe("/repo")
  })

  test("falls back to the directory for non-git projects", () => {
    expect(projectRoot("/repo", "/")).toBe("/repo")
  })

  test("skips missing directories", () => {
    expect(projectRoot(undefined, undefined)).toBeUndefined()
  })

  test("does not reopen the same project twice", () => {
    const opened: string[] = []
    let synced = syncProject(undefined, "/repo", "/repo", (directory) => {
      opened.push(directory)
    })

    synced = syncProject(synced, "/repo", "/repo", (directory) => {
      opened.push(directory)
    })

    expect(synced).toBe("/repo")
    expect(opened).toEqual(["/repo"])
  })

  test("replaces a fallback directory with the resolved worktree root", () => {
    const opened: string[] = []
    const closed: string[] = []

    let synced = syncProject(undefined, "/repo/worktree", "/", (directory) => {
      opened.push(directory)
    })

    synced = syncProject(
      synced,
      "/repo/worktree",
      "/repo",
      (directory) => {
        opened.push(directory)
      },
      (directory) => {
        closed.push(directory)
      },
    )

    expect(synced).toBe("/repo")
    expect(opened).toEqual(["/repo/worktree", "/repo"])
    expect(closed).toEqual(["/repo/worktree"])
  })
})
