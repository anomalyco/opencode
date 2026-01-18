import { describe, expect, test } from "bun:test"

/**
 * Tests for project reordering logic.
 *
 * Projects can be reordered via drag-and-drop (desktop) or
 * "Move up/down" menu options (mobile).
 */

type Project = { worktree: string; name?: string }

/**
 * Moves a project from one index to another.
 * Returns the new array with the project moved.
 */
function moveProject(projects: Project[], worktree: string, toIndex: number): Project[] {
  const fromIndex = projects.findIndex((p) => p.worktree === worktree)
  if (fromIndex === -1) return projects
  if (toIndex < 0 || toIndex >= projects.length) return projects
  if (fromIndex === toIndex) return projects

  const result = [...projects]
  const [removed] = result.splice(fromIndex, 1)
  result.splice(toIndex, 0, removed)
  return result
}

/**
 * Determines if a project can move up (index > 0).
 */
function canMoveUp(projects: Project[], worktree: string): boolean {
  const index = projects.findIndex((p) => p.worktree === worktree)
  return index > 0
}

/**
 * Determines if a project can move down (index < length - 1).
 */
function canMoveDown(projects: Project[], worktree: string): boolean {
  const index = projects.findIndex((p) => p.worktree === worktree)
  return index !== -1 && index < projects.length - 1
}

describe("moveProject", () => {
  const projects: Project[] = [
    { worktree: "/a", name: "A" },
    { worktree: "/b", name: "B" },
    { worktree: "/c", name: "C" },
  ]

  test("moves project up", () => {
    const result = moveProject(projects, "/b", 0)
    expect(result.map((p) => p.worktree)).toEqual(["/b", "/a", "/c"])
  })

  test("moves project down", () => {
    const result = moveProject(projects, "/a", 1)
    expect(result.map((p) => p.worktree)).toEqual(["/b", "/a", "/c"])
  })

  test("moves project to end", () => {
    const result = moveProject(projects, "/a", 2)
    expect(result.map((p) => p.worktree)).toEqual(["/b", "/c", "/a"])
  })

  test("returns original array if project not found", () => {
    const result = moveProject(projects, "/nonexistent", 1)
    expect(result).toEqual(projects)
  })

  test("returns original array if toIndex is out of bounds", () => {
    expect(moveProject(projects, "/a", -1)).toEqual(projects)
    expect(moveProject(projects, "/a", 10)).toEqual(projects)
  })

  test("returns original array if moving to same position", () => {
    const result = moveProject(projects, "/b", 1)
    expect(result).toEqual(projects)
  })

  test("does not mutate original array", () => {
    const original = [...projects]
    moveProject(projects, "/a", 2)
    expect(projects).toEqual(original)
  })
})

describe("canMoveUp", () => {
  const projects: Project[] = [{ worktree: "/a" }, { worktree: "/b" }, { worktree: "/c" }]

  test("returns false for first project", () => {
    expect(canMoveUp(projects, "/a")).toBe(false)
  })

  test("returns true for middle project", () => {
    expect(canMoveUp(projects, "/b")).toBe(true)
  })

  test("returns true for last project", () => {
    expect(canMoveUp(projects, "/c")).toBe(true)
  })

  test("returns false for nonexistent project", () => {
    expect(canMoveUp(projects, "/nonexistent")).toBe(false)
  })
})

describe("canMoveDown", () => {
  const projects: Project[] = [{ worktree: "/a" }, { worktree: "/b" }, { worktree: "/c" }]

  test("returns true for first project", () => {
    expect(canMoveDown(projects, "/a")).toBe(true)
  })

  test("returns true for middle project", () => {
    expect(canMoveDown(projects, "/b")).toBe(true)
  })

  test("returns false for last project", () => {
    expect(canMoveDown(projects, "/c")).toBe(false)
  })

  test("returns false for nonexistent project", () => {
    expect(canMoveDown(projects, "/nonexistent")).toBe(false)
  })
})

describe("move up/down integration", () => {
  test("move up decrements index by 1", () => {
    const projects: Project[] = [{ worktree: "/a" }, { worktree: "/b" }, { worktree: "/c" }]

    // Simulate "Move up" for /b
    const index = projects.findIndex((p) => p.worktree === "/b")
    if (index > 0) {
      const result = moveProject(projects, "/b", index - 1)
      expect(result.map((p) => p.worktree)).toEqual(["/b", "/a", "/c"])
    }
  })

  test("move down increments index by 1", () => {
    const projects: Project[] = [{ worktree: "/a" }, { worktree: "/b" }, { worktree: "/c" }]

    // Simulate "Move down" for /b
    const index = projects.findIndex((p) => p.worktree === "/b")
    if (index < projects.length - 1) {
      const result = moveProject(projects, "/b", index + 1)
      expect(result.map((p) => p.worktree)).toEqual(["/a", "/c", "/b"])
    }
  })
})
