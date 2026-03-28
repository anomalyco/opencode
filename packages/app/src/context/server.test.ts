import { describe, expect, test } from "bun:test"
import { projectIndex } from "./server"

describe("projectIndex", () => {
  test("matches path variants for the same workspace", () => {
    expect(projectIndex([{ worktree: "C:/Users/Alice/code/demo" }], "C:\\Users\\Alice\\code\\demo\\")).toBe(0)
    expect(projectIndex([{ worktree: "/tmp/demo" }], "/tmp/demo///")).toBe(0)
  })

  test("returns -1 for a different workspace", () => {
    expect(projectIndex([{ worktree: "/tmp/demo" }], "/tmp/other")).toBe(-1)
  })
})
