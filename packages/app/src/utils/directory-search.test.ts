import { describe, expect, test } from "bun:test"
import {
  joinPath,
  displayPath,
  normalizeQuery,
  projectsToRelative,
  filterProjects,
  combineResults,
} from "./directory-search"

describe("directory-search utilities", () => {
  describe("joinPath", () => {
    test("joins base and relative paths", () => {
      expect(joinPath("/Users/foo", "bar")).toBe("/Users/foo/bar")
      expect(joinPath("/Users/foo/", "bar")).toBe("/Users/foo/bar")
      expect(joinPath("/Users/foo", "/bar")).toBe("/Users/foo/bar")
      expect(joinPath("/Users/foo/", "/bar/")).toBe("/Users/foo/bar")
    })

    test("handles empty base", () => {
      expect(joinPath("", "bar")).toBe("bar")
      expect(joinPath(undefined, "bar")).toBe("bar")
    })

    test("handles empty relative", () => {
      expect(joinPath("/Users/foo", "")).toBe("/Users/foo")
      expect(joinPath("/Users/foo/", "")).toBe("/Users/foo")
    })

    test("handles both empty", () => {
      expect(joinPath("", "")).toBe("")
      expect(joinPath(undefined, "")).toBe("")
    })
  })

  describe("displayPath", () => {
    const home = "/Users/athal"

    test("shows ~ for home directory", () => {
      expect(displayPath("/Users/athal", home)).toBe("~")
    })

    test("shows ~/relative for paths under home", () => {
      expect(displayPath("/Users/athal/Documents", home)).toBe("~/Documents")
      expect(displayPath("/Users/athal/Documents/GitHub", home)).toBe("~/Documents/GitHub")
    })

    test("shows full path for paths outside home", () => {
      expect(displayPath("/opt/homebrew", home)).toBe("/opt/homebrew")
      expect(displayPath("/var/log", home)).toBe("/var/log")
    })

    test("handles undefined home", () => {
      expect(displayPath("/Users/athal/Documents", undefined)).toBe("/Users/athal/Documents")
    })
  })

  describe("normalizeQuery", () => {
    const home = "/Users/athal"

    test("removes ~/ prefix", () => {
      expect(normalizeQuery("~/Documents", home)).toBe("Documents")
      expect(normalizeQuery("~/Documents/GitHub", home)).toBe("Documents/GitHub")
    })

    test("removes home directory prefix", () => {
      expect(normalizeQuery("/Users/athal/Documents", home)).toBe("Documents")
      expect(normalizeQuery("/Users/athal", home)).toBe("")
    })

    test("handles case-insensitive home prefix", () => {
      expect(normalizeQuery("/USERS/ATHAL/Documents", home)).toBe("Documents")
    })

    test("returns query unchanged for other paths", () => {
      expect(normalizeQuery("Documents", home)).toBe("Documents")
      expect(normalizeQuery("opencode", home)).toBe("opencode")
    })

    test("handles empty query", () => {
      expect(normalizeQuery("", home)).toBe("")
    })

    test("handles undefined home", () => {
      expect(normalizeQuery("~/Documents", undefined)).toBe("Documents")
      expect(normalizeQuery("/Users/athal/Documents", undefined)).toBe("/Users/athal/Documents")
    })
  })

  describe("projectsToRelative", () => {
    const home = "/Users/athal"

    test("converts absolute paths to relative", () => {
      const projects = [
        { worktree: "/Users/athal/Documents/GitHub/opencode" },
        { worktree: "/Users/athal/Documents/GitHub/chezmoi" },
      ]
      expect(projectsToRelative(projects, home)).toEqual(["Documents/GitHub/opencode", "Documents/GitHub/chezmoi"])
    })

    test("keeps paths outside home as absolute", () => {
      const projects = [{ worktree: "/opt/projects/foo" }, { worktree: "/Users/athal/bar" }]
      expect(projectsToRelative(projects, home)).toEqual(["/opt/projects/foo", "bar"])
    })

    test("filters out undefined worktrees", () => {
      const projects = [{ worktree: "/Users/athal/foo" }, { worktree: undefined }, { worktree: "" }]
      expect(projectsToRelative(projects, home)).toEqual(["foo"])
    })

    test("handles undefined home", () => {
      const projects = [{ worktree: "/Users/athal/foo" }]
      expect(projectsToRelative(projects, undefined)).toEqual(["/Users/athal/foo"])
    })
  })

  describe("filterProjects", () => {
    const projects = [
      "Documents/GitHub/opencode",
      "Documents/GitHub/chezmoi",
      "Projects/work/api",
      "Projects/personal/blog",
    ]

    test("filters by partial match", () => {
      expect(filterProjects(projects, "open")).toEqual(["Documents/GitHub/opencode"])
      expect(filterProjects(projects, "GitHub")).toEqual(["Documents/GitHub/opencode", "Documents/GitHub/chezmoi"])
    })

    test("is case-insensitive", () => {
      expect(filterProjects(projects, "OPEN")).toEqual(["Documents/GitHub/opencode"])
      expect(filterProjects(projects, "github")).toEqual(["Documents/GitHub/opencode", "Documents/GitHub/chezmoi"])
    })

    test("returns all projects for empty query", () => {
      expect(filterProjects(projects, "")).toEqual(projects)
    })

    test("returns empty array for no matches", () => {
      expect(filterProjects(projects, "nonexistent")).toEqual([])
    })
  })

  describe("combineResults", () => {
    test("puts projects first", () => {
      const projects = ["foo", "bar"]
      const search = ["baz", "qux"]
      expect(combineResults(projects, search)).toEqual(["foo", "bar", "baz", "qux"])
    })

    test("deduplicates results", () => {
      const projects = ["foo", "bar"]
      const search = ["bar", "baz", "foo"]
      expect(combineResults(projects, search)).toEqual(["foo", "bar", "baz"])
    })

    test("respects limit", () => {
      const projects = ["a", "b"]
      const search = ["c", "d", "e", "f"]
      expect(combineResults(projects, search, 4)).toEqual(["a", "b", "c", "d"])
    })

    test("handles empty projects", () => {
      const projects: string[] = []
      const search = ["foo", "bar"]
      expect(combineResults(projects, search)).toEqual(["foo", "bar"])
    })

    test("handles empty search", () => {
      const projects = ["foo", "bar"]
      const search: string[] = []
      expect(combineResults(projects, search)).toEqual(["foo", "bar"])
    })
  })
})
