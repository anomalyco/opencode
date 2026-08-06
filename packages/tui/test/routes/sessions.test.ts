import { describe, expect, test } from "bun:test"
import path from "path"
import {
  compareSessionDirectories,
  createSessionsListQuery,
  directorySuggestions,
  parseNewSessionInput,
} from "../../src/routes/sessions"

describe("sessions list", () => {
  test("compares directory groups deterministically", () => {
    expect(compareSessionDirectories("/workspace/project2", "/workspace/project10")).toBeLessThan(0)
    expect(compareSessionDirectories("/workspace/API", "/workspace/api")).toBeLessThan(0)
    expect(compareSessionDirectories("/workspace/api", "/workspace/API")).toBeGreaterThan(0)
  })

  test("requests root sessions for the default browse list", () => {
    expect(createSessionsListQuery({})).toEqual({
      roots: true,
      limit: 100,
    })
  })

  test("requests root sessions with a trimmed search term", () => {
    expect(createSessionsListQuery({ search: " deploy " })).toEqual({
      roots: true,
      limit: 30,
      search: "deploy",
    })
  })
})

describe("parseNewSessionInput", () => {
  const paths = { cwd: "/work/current", home: "/home/user" }

  test("treats plain text as a prompt in the current directory", () => {
    expect(parseNewSessionInput("fix the bug", paths)).toEqual({ directory: undefined, prompt: "fix the bug" })
  })

  test("trims surrounding whitespace", () => {
    expect(parseNewSessionInput("  hello  ", paths)).toEqual({ directory: undefined, prompt: "hello" })
  })

  test("extracts an absolute @path without a prompt", () => {
    expect(parseNewSessionInput("@/repos/api", paths)).toEqual({ directory: "/repos/api", prompt: "" })
  })

  test("extracts an absolute @path with a prompt", () => {
    expect(parseNewSessionInput("@/repos/api run the tests", paths)).toEqual({
      directory: "/repos/api",
      prompt: "run the tests",
    })
  })

  test("expands ~ against the home directory", () => {
    expect(parseNewSessionInput("@~/proj x", paths)).toEqual({
      directory: path.join("/home/user", "proj"),
      prompt: "x",
    })
  })

  test("resolves a relative @path against the cwd", () => {
    expect(parseNewSessionInput("@packages/tui", paths)).toEqual({
      directory: path.resolve("/work/current", "packages/tui"),
      prompt: "",
    })
  })

  test("a lone @ is kept as prompt text", () => {
    expect(parseNewSessionInput("@ not-a-path", paths)).toEqual({ directory: undefined, prompt: "@ not-a-path" })
  })

  test("parses a quoted @path containing spaces", () => {
    expect(parseNewSessionInput('@"/repos/my dir" run the tests', paths)).toEqual({
      directory: "/repos/my dir",
      prompt: "run the tests",
    })
  })

  test("parses a quoted relative @path without a prompt", () => {
    expect(parseNewSessionInput('@"packages/my dir"', paths)).toEqual({
      directory: path.resolve("/work/current", "packages/my dir"),
      prompt: "",
    })
  })
})

describe("directorySuggestions", () => {
  const paths = { cwd: "/work/current", home: "/home/user" }
  const tree: Record<string, string[]> = {
    "/work/current": ["packages", "src", ".git", "node_modules"],
    "/work/current/packages": ["tui", "opencode"],
    "/home/user": ["projects", "downloads"],
    "/": ["mnt", "home"],
  }
  const readdir = (dir: string) => tree[dir] ?? []

  test("does not fire without a leading @", () => {
    expect(directorySuggestions("fix the bug", paths, readdir)).toEqual([])
    expect(directorySuggestions("", paths, readdir)).toEqual([])
  })

  test("lists directories of the cwd for a bare @", () => {
    expect(directorySuggestions("@", paths, readdir)).toEqual(["packages", "src"])
  })

  test("fuzzy-searches nested directories from the cwd", () => {
    const result = directorySuggestions("@pac", paths, readdir)
    expect(result[0]).toBe("packages")
    expect(result).toContain("packages/opencode")
    expect(result).toContain("packages/tui")
  })

  test("finds a nested directory by name without descending", () => {
    expect(directorySuggestions("@opencode", paths, readdir)).toEqual(["packages/opencode"])
  })

  test("stops searching past four levels", () => {
    const deep: Record<string, string[]> = {
      "/work/current": ["a"],
      "/work/current/a": ["b"],
      "/work/current/a/b": ["c"],
      "/work/current/a/b/c": ["d"],
      "/work/current/a/b/c/d": ["deep"],
    }
    expect(directorySuggestions("@deep", paths, (dir) => deep[dir] ?? [])).toEqual([])
  })

  test("descends into a path ending with a slash", () => {
    expect(directorySuggestions("@packages/", paths, readdir)).toEqual(["packages/opencode", "packages/tui"])
  })

  test("fuzzy-matches the last segment of a partial path", () => {
    expect(directorySuggestions("@packages/t", paths, readdir)).toEqual(["packages/tui"])
  })

  test("expands ~ against the home directory", () => {
    expect(directorySuggestions("@~/pr", paths, readdir)).toEqual(["/home/user/projects"])
  })

  test("lists the home directory for a bare ~ token", () => {
    expect(directorySuggestions("@~", paths, readdir)).toEqual(["/home/user/downloads", "/home/user/projects"])
  })

  test("lists the filesystem root", () => {
    expect(directorySuggestions("@/", paths, readdir)).toEqual(["/home", "/mnt"])
  })

  test("keeps dotfiles hidden unless the needle starts with a dot", () => {
    const withDot: Record<string, string[]> = { "/work/current": [".config", "src"] }
    expect(directorySuggestions("@", paths, (dir) => withDot[dir] ?? [])).toEqual(["src"])
    expect(directorySuggestions("@.", paths, (dir) => withDot[dir] ?? [])).toEqual([".config"])
  })

  test("caps the list at eight entries", () => {
    const many: Record<string, string[]> = { "/work/current": ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"] }
    expect(directorySuggestions("@", paths, (dir) => many[dir] ?? [])).toHaveLength(8)
  })

  test("stops firing once prompt text follows the path", () => {
    expect(directorySuggestions("@/mnt fix things", paths, readdir)).toEqual([])
  })
})
