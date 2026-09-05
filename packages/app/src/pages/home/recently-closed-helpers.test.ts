import { describe, expect, test } from "bun:test"
import {
  buildClosedStateMap,
  countClosedStates,
  filterAndSortClosedProjects,
  filterClosedByState,
  matchesClosedQuery,
  sortClosedProjects,
} from "./recently-closed-helpers"
import type { LocalProject } from "@/context/layout"

const project = (worktree: string, name?: string): LocalProject =>
  ({ worktree, expanded: false, ...(name ? { name } : {}) }) as LocalProject

describe("matchesClosedQuery", () => {
  test("matches name and path case-insensitively", () => {
    expect(matchesClosedQuery(project("/repo/codex", "codex"), "COD")).toBe(true)
    expect(matchesClosedQuery(project("/repo/codex", "codex"), "codex")).toBe(true)
    expect(matchesClosedQuery(project("/repo/codex", "codex"), "/repo")).toBe(true)
    expect(matchesClosedQuery(project("/repo/codex", "codex"), "other")).toBe(false)
    expect(matchesClosedQuery(project("/repo/codex", "codex"), "")).toBe(true)
  })
})

describe("filterClosedByState", () => {
  test("separates recent, archived and hidden", () => {
    const items = [project("/a"), project("/b"), project("/c")]
    const states = new Map([
      ["/a", { hidden: false, archived: false }],
      ["/b", { hidden: false, archived: true }],
      ["/c", { hidden: true, archived: false }],
    ])
    expect(filterClosedByState(items, states, "all")).toHaveLength(3)
    expect(filterClosedByState(items, states, "recent").map((item) => item.worktree)).toEqual(["/a"])
    expect(filterClosedByState(items, states, "archived").map((item) => item.worktree)).toEqual(["/b"])
    expect(filterClosedByState(items, states, "hidden").map((item) => item.worktree)).toEqual(["/c"])
  })
})

describe("sortClosedProjects", () => {
  test("keeps recency order by default and sorts by name otherwise", () => {
    const items = [project("/c", "Charlie"), project("/a", "alpha"), project("/b", "Bravo")]
    expect(sortClosedProjects(items, "recent").map((item) => item.worktree)).toEqual(["/c", "/a", "/b"])
    expect(sortClosedProjects(items, "name-asc").map((item) => item.worktree)).toEqual(["/a", "/b", "/c"])
    expect(sortClosedProjects(items, "name-desc").map((item) => item.worktree)).toEqual(["/c", "/b", "/a"])
  })
})

describe("filterAndSortClosedProjects", () => {
  test("combines query, filter and sort", () => {
    const items = [project("/repo/beta", "beta"), project("/repo/alpha", "alpha"), project("/other/gamma", "gamma")]
    const states = new Map([
      ["/repo/beta", { hidden: false, archived: false }],
      ["/repo/alpha", { hidden: false, archived: false }],
      ["/other/gamma", { hidden: false, archived: false }],
    ])
    const result = filterAndSortClosedProjects(items, states, { query: "repo", filter: "all", sort: "name-asc" })
    expect(result.map((item) => item.worktree)).toEqual(["/repo/alpha", "/repo/beta"])
  })
})

describe("countClosedStates", () => {
  test("counts recent, archived and hidden", () => {
    const items = [project("/a"), project("/b"), project("/c"), project("/d")]
    const states = buildClosedStateMap(
      items,
      (dir) => dir === "/c",
      (dir) => dir === "/b" || dir === "/d",
    )
    expect(countClosedStates(items, states)).toEqual({ total: 4, recent: 1, archived: 2, hidden: 1 })
  })
})
