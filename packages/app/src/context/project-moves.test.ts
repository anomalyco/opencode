import { describe, expect, test } from "bun:test"
import { trackProjectMoves } from "./project-moves"

describe("trackProjectMoves", () => {
  test("reports nothing on first sight of a project", () => {
    const seen = new Map<string, string>()
    const moves = trackProjectMoves(seen, [{ id: "a", worktree: "/repo" }])
    expect(moves).toEqual([])
    expect(seen.get("a")).toBe("/repo")
  })

  test("reports a move when a known project changes worktree", () => {
    const seen = new Map<string, string>()
    trackProjectMoves(seen, [{ id: "a", worktree: "/repo.old" }])
    const moves = trackProjectMoves(seen, [{ id: "a", worktree: "/repo.new" }])
    expect(moves).toEqual([{ id: "a", from: "/repo.old", to: "/repo.new" }])
    expect(seen.get("a")).toBe("/repo.new")
  })

  test("does not report unchanged worktrees", () => {
    const seen = new Map<string, string>()
    trackProjectMoves(seen, [{ id: "a", worktree: "/repo" }])
    expect(trackProjectMoves(seen, [{ id: "a", worktree: "/repo" }])).toEqual([])
  })

  test("reports each transition exactly once", () => {
    const seen = new Map<string, string>()
    trackProjectMoves(seen, [{ id: "a", worktree: "/repo.old" }])
    trackProjectMoves(seen, [{ id: "a", worktree: "/repo.new" }])
    expect(trackProjectMoves(seen, [{ id: "a", worktree: "/repo.new" }])).toEqual([])
  })

  test("tracks multiple projects independently", () => {
    const seen = new Map<string, string>()
    trackProjectMoves(seen, [
      { id: "a", worktree: "/one" },
      { id: "b", worktree: "/two" },
    ])
    const moves = trackProjectMoves(seen, [
      { id: "a", worktree: "/one.moved" },
      { id: "b", worktree: "/two" },
    ])
    expect(moves).toEqual([{ id: "a", from: "/one", to: "/one.moved" }])
  })

  test("two projects swapping does not lose either transition", () => {
    const seen = new Map<string, string>()
    trackProjectMoves(seen, [
      { id: "a", worktree: "/one" },
      { id: "b", worktree: "/two" },
    ])
    const moves = trackProjectMoves(seen, [
      { id: "a", worktree: "/two" },
      { id: "b", worktree: "/one" },
    ])
    expect(moves).toEqual([
      { id: "a", from: "/one", to: "/two" },
      { id: "b", from: "/two", to: "/one" },
    ])
  })
})
