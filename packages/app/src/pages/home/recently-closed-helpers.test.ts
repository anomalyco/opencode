import { describe, expect, test } from "bun:test"
import {
  closedEntries,
  countClosedEntries,
  filterClosedEntries,
  matchesClosedQuery,
  sortClosedEntries,
} from "./recently-closed-helpers"
import type { LocalProject } from "@/context/layout"

const project = (worktree: string, name?: string): LocalProject => ({ worktree, expanded: false, name })
const worktrees = (entries: { project: LocalProject }[]) => entries.map((entry) => entry.project.worktree)

describe("matchesClosedQuery", () => {
  test("matches display name and path case-insensitively", () => {
    const item = project("/repo/codex", "Codex")
    expect(matchesClosedQuery(item, "cod")).toBe(true)
    expect(matchesClosedQuery(item, "  CODEX ")).toBe(true)
    expect(matchesClosedQuery(item, "/repo")).toBe(true)
    expect(matchesClosedQuery(item, "other")).toBe(false)
    expect(matchesClosedQuery(item, "")).toBe(true)
  })

  test("matches windows paths regardless of slash direction", () => {
    const item = project("C:\\Users\\dev\\Objetos 3D")
    expect(matchesClosedQuery(item, "objetos")).toBe(true)
    expect(matchesClosedQuery(item, "users/dev")).toBe(true)
    expect(matchesClosedQuery(item, "users\\dev")).toBe(true)
  })
})

describe("filterClosedEntries", () => {
  const entries = closedEntries(
    [project("/a"), project("/b"), project("/c"), project("/d")],
    (directory) => directory === "/c" || directory === "/d",
    (directory) => directory === "/b" || directory === "/d",
  )

  test("recent excludes hidden and archived entries", () => {
    expect(worktrees(filterClosedEntries(entries, "recent"))).toEqual(["/a"])
  })

  test("archived and hidden may overlap and all keeps everything", () => {
    expect(worktrees(filterClosedEntries(entries, "archived"))).toEqual(["/b", "/d"])
    expect(worktrees(filterClosedEntries(entries, "hidden"))).toEqual(["/c", "/d"])
    expect(worktrees(filterClosedEntries(entries, "all"))).toEqual(["/a", "/b", "/c", "/d"])
  })
})

describe("sortClosedEntries", () => {
  const entries = closedEntries(
    [project("/c", "Charlie"), project("/a", "alpha"), project("/b", "Bravo")],
    () => false,
    () => false,
  )

  test("recent keeps stored order and oldest reverses it", () => {
    expect(worktrees(sortClosedEntries(entries, "recent"))).toEqual(["/c", "/a", "/b"])
    expect(worktrees(sortClosedEntries(entries, "oldest"))).toEqual(["/b", "/a", "/c"])
    expect(worktrees(entries)).toEqual(["/c", "/a", "/b"])
  })

  test("sorts by name ignoring case in both directions", () => {
    expect(worktrees(sortClosedEntries(entries, "name-asc"))).toEqual(["/a", "/b", "/c"])
    expect(worktrees(sortClosedEntries(entries, "name-desc"))).toEqual(["/c", "/b", "/a"])
  })

  test("breaks equal names by path so descending mirrors ascending", () => {
    const duplicates = closedEntries(
      [project("/work/app"), project("/home/app"), project("/other/App"), project("/home/zeta")],
      () => false,
      () => false,
    )
    const ascending = worktrees(sortClosedEntries(duplicates, "name-asc"))
    expect(ascending).toEqual(["/home/app", "/other/App", "/work/app", "/home/zeta"])
    expect(worktrees(sortClosedEntries(duplicates, "name-desc"))).toEqual([...ascending].reverse())
  })

  test("is deterministic for entries with identical names and paths", () => {
    const same = closedEntries(
      [project("/a", "same"), project("/a/", "same")],
      () => false,
      () => false,
    )
    expect(worktrees(sortClosedEntries(same, "name-asc"))).toEqual(["/a", "/a/"])
    expect(worktrees(sortClosedEntries(same, "name-desc"))).toEqual(["/a/", "/a"])
  })
})

describe("countClosedEntries", () => {
  test("counts every filter bucket", () => {
    const entries = closedEntries(
      [project("/a"), project("/b"), project("/c"), project("/d")],
      (directory) => directory === "/c" || directory === "/d",
      (directory) => directory === "/b" || directory === "/d",
    )
    expect(countClosedEntries(entries)).toEqual({ all: 4, recent: 1, archived: 2, hidden: 2 })
  })
})
