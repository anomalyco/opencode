import { describe, expect, test } from "bun:test"
import { syncProject } from "./directory-layout-sync"

describe("directory layout project registration", () => {
  test("registers a git worktree", () => {
    const opened: string[] = []

    syncProject("/repo/worktree", "/repo", (directory) => {
      opened.push(directory)
    })

    expect(opened).toEqual(["/repo"])
  })

  test("falls back to the directory for non-git projects", () => {
    const opened: string[] = []

    syncProject("/repo", "/", (directory) => {
      opened.push(directory)
    })

    expect(opened).toEqual(["/repo"])
  })

  test("skips missing directories", () => {
    const opened: string[] = []

    syncProject(undefined, undefined, (directory) => {
      opened.push(directory)
    })

    expect(opened).toEqual([])
  })
})
