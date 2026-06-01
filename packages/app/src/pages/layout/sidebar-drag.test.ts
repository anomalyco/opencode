import { describe, expect, test } from "bun:test"
import type { LocalProject } from "@/context/layout"
import { dragOverlayProject } from "./sidebar-drag"

const project = (worktree: string): LocalProject => ({ worktree, expanded: false })

describe("dragOverlayProject", () => {
  test("matches active worktree from plain project list", () => {
    const projects = [project("a"), project("b")]
    expect(dragOverlayProject(projects, "b")?.worktree).toBe("b")
  })

  test("returns undefined when active project is missing", () => {
    expect(dragOverlayProject([project("a")], "missing")).toBeUndefined()
  })

  test("returns undefined without active project", () => {
    expect(dragOverlayProject([project("a")])).toBeUndefined()
  })
})
