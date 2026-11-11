import { describe, expect, test } from "bun:test"
import { measureEditText } from "@opentui/core"
import path from "path"
import type { KeymapCommand } from "@opencode/plugin/tui/context"
import {
  directoryAutocomplete,
  directoryAutocompleteExactValue,
  directoryAutocompleteMatches,
  directoryAutocompleteResultValue,
  directoryAutocompleteSearch,
  directoryRecentValue,
  mentionAutocomplete,
  mentionFileSearch,
  mentionFileName,
  slashArgumentAutocomplete,
} from "../../src/prompt/directory-completion"

describe("directoryAutocomplete", () => {
  test("lists parents and siblings without changing location", async () => {
    const location = { directory: "/project/current" }
    const calls: unknown[] = []
    const file = {
      list: async (input: unknown) => {
        calls.push(input)
        return {
          location: {
            directory: location.directory,
            project: { id: "proj_test", directory: "/project", canonical: "/project" },
          },
          data: [
            { path: "./", type: "directory" },
            { path: "../sibling/", type: "directory" },
            { path: "../.hidden/", type: "directory" },
            { path: "../README.md", type: "file" },
          ],
        }
      },
    } as Parameters<typeof directoryAutocomplete>[0]
    expect(await directoryAutocomplete(file, location, "..", "/home/user")).toEqual([
      { value: "..", absolute: path.resolve("/project") },
      { value: "../current/", absolute: path.resolve("/project/current") },
      { value: "../sibling/", absolute: path.resolve("/project/sibling") },
    ])
    expect(await directoryAutocomplete(file, location, "../sib", "/home/user")).toEqual([
      { value: "../sibling/", absolute: path.resolve("/project/sibling") },
    ])
    expect(calls).toEqual([
      { location, path: path.resolve("/project") },
      { location, path: path.resolve("/project") },
    ])
  })

  test("resolves home and nested sibling completions against the current location", async () => {
    const location = { directory: "/project/current" }
    const calls: unknown[] = []
    const file = {
      list: async (input: unknown) => {
        calls.push(input)
        return {
          location: {
            directory: location.directory,
            project: { id: "proj_test", directory: "/project", canonical: "/project" },
          },
          data: [{ path: "../sibling/src/", type: "directory" }],
        }
      },
    } as Parameters<typeof directoryAutocomplete>[0]
    expect(await directoryAutocomplete(file, location, "../sibling/s", "/project/sibling")).toEqual([
      { value: "../sibling/src/", absolute: path.resolve("/project/sibling/src") },
    ])
    expect(await directoryAutocomplete(file, location, "~", "/project/sibling")).toEqual([
      { value: "~", absolute: "/project/sibling" },
      { value: "~/src/", absolute: path.resolve("/project/sibling/src") },
    ])
    expect(calls).toEqual([
      { location, path: path.resolve("/project/sibling") },
      { location, path: "/project/sibling" },
    ])
  })
})

const commands = [
  {
    id: "session.cd",
    slash: { name: "cd", aliases: ["chdir"], arguments: true },
    run: () => undefined,
  },
] satisfies KeymapCommand[]

const argumentAutocomplete = (command: KeymapCommand) =>
  command.id === "session.cd" ? ("directory" as const) : undefined

describe("slashArgumentAutocomplete", () => {
  test.each([
    ["/cd ", "/cd "],
    ["/cd src", "/cd "],
    ["/chdir src", "/chdir "],
    ["/cd\t中文", "/cd\t"],
  ])("starts %j after the command separator", (beforeCursor, head) => {
    expect(slashArgumentAutocomplete(beforeCursor, "unicode", commands, argumentAutocomplete)).toEqual({
      type: "directory",
      index: measureEditText(head, { widthMethod: "unicode" }),
    })
  })

  test("does not complete the command token", () => {
    expect(slashArgumentAutocomplete("/cd", "unicode", commands, argumentAutocomplete)).toBeUndefined()
    expect(slashArgumentAutocomplete("/other ", "unicode", commands, argumentAutocomplete)).toBeUndefined()
  })
})

describe("directoryAutocompleteSearch", () => {
  test("searches from home after a home prefix", () => {
    expect(directoryAutocompleteSearch("~", "/project", "/home/user")).toEqual({
      directory: "/home/user",
      prefix: "~/",
      query: "",
    })
    expect(directoryAutocompleteSearch("~/pro", "/project", "/home/user")).toEqual({
      directory: "/home/user",
      prefix: "~/",
      query: "pro",
    })
    expect(directoryAutocompleteSearch("~/projects/open", "/project", "/home/user")).toEqual({
      // The implementation resolves subdirectories with the platform path
      // module, so expectations resolve too (drive-prefixed on Windows).
      directory: path.resolve("/home/user/projects"),
      prefix: "~/projects/",
      query: "open",
    })
  })

  test("searches from parent prefixes", () => {
    expect(directoryAutocompleteSearch("..", "/project/src", "/home/user")).toEqual({
      directory: path.resolve("/project"),
      prefix: "../",
      query: "",
    })
    expect(directoryAutocompleteSearch("../../pac", "/project/src/lib", "/home/user")).toEqual({
      directory: path.resolve("/project"),
      prefix: "../../",
      query: "pac",
    })
    expect(directoryAutocompleteSearch("../../..", "/project/src/lib", "/home/user")).toEqual({
      directory: path.resolve("/"),
      prefix: "../../../",
      query: "",
    })
  })

  test("keeps ordinary searches rooted at the current directory", () => {
    expect(directoryAutocompleteSearch("src", "/project", "/home/user")).toEqual({
      directory: "/project",
      prefix: "",
      query: "src",
    })
    expect(directoryAutocompleteSearch("packages/core", "/project", "/home/user")).toEqual({
      directory: path.resolve("/project/packages"),
      prefix: "packages/",
      query: "core",
    })
    expect(directoryAutocompleteSearch("/root/pro", "/project", "/home/user")).toEqual({
      directory: path.resolve("/root"),
      prefix: "/root/",
      query: "pro",
    })
  })
})

describe("directoryAutocompleteResultValue", () => {
  test("preserves explicit roots", () => {
    expect(
      directoryAutocompleteResultValue("projects/", directoryAutocompleteSearch("~/", "/project", "/home/user")),
    ).toBe("~/projects/")
    expect(
      directoryAutocompleteResultValue("src/", directoryAutocompleteSearch("../", "/project/pkg", "/home/user")),
    ).toBe("../src/")
  })
})

describe("directoryAutocompleteExactValue", () => {
  test("includes complete explicit roots", () => {
    expect(
      directoryAutocompleteExactValue("../..", directoryAutocompleteSearch("../..", "/project/pkg", "/home/user")),
    ).toBe("../..")
    expect(directoryAutocompleteExactValue("~", directoryAutocompleteSearch("~", "/project", "/home/user"))).toBe("~")
  })

  test("omits incomplete and implicit roots", () => {
    expect(
      directoryAutocompleteExactValue("../../src", directoryAutocompleteSearch("../../src", "/project", "/home/user")),
    ).toBeUndefined()
    expect(
      directoryAutocompleteExactValue("", directoryAutocompleteSearch("", "/project", "/home/user")),
    ).toBeUndefined()
  })
})

describe("directoryAutocompleteMatches", () => {
  test("hides dot directories for an empty component", () => {
    expect(directoryAutocompleteMatches("src/", "")).toBe(true)
    expect(directoryAutocompleteMatches(".git/", "")).toBe(false)
  })

  test("shows dot directories when explicitly filtered", () => {
    expect(directoryAutocompleteMatches(".git/", ".")).toBe(true)
    expect(directoryAutocompleteMatches(".github/", ".gi")).toBe(true)
    expect(directoryAutocompleteMatches(".zed/", ".gi")).toBe(false)
  })
})

describe("directoryRecentValue", () => {
  test("abbreviates home paths", () => {
    expect(directoryRecentValue("/home/user", "/home/user")).toBe("~")
    expect(directoryRecentValue("/home/user/projects/opencode", "/home/user")).toBe("~/projects/opencode")
  })

  test("keeps paths outside home absolute", () => {
    expect(directoryRecentValue("/project/recent", "/home/user")).toBe("/project/recent")
  })
})

describe("mentionFileSearch", () => {
  test("expands the home form before searching", () => {
    expect(mentionFileSearch("~", "/project/current", "/home/user")).toEqual({
      directory: "/home/user",
      prefix: "~/",
      fragment: "",
    })
    expect(mentionFileSearch("~/", "/project/current", "/home/user")).toEqual({
      directory: "/home/user",
      prefix: "~/",
      fragment: "",
    })
    expect(mentionFileSearch("~/sub/file", "/project/current", "/home/user")).toEqual({
      directory: path.resolve("/home/user/sub"),
      prefix: "~/sub/",
      fragment: "file",
    })
    expect(mentionFileSearch("~/sub/fra", "/project/current", "/home/user")).toEqual({
      directory: path.resolve("/home/user/sub"),
      prefix: "~/sub/",
      fragment: "fra",
    })
    expect(mentionFileSearch("~/sub/", "/project/current", "/home/user")).toEqual({
      directory: path.resolve("/home/user/sub"),
      prefix: "~/sub/",
      fragment: "",
    })
  })

  test("parses absolute queries", () => {
    expect(mentionFileSearch("/", "/project/current", "/home/user")).toEqual({
      directory: path.parse("/project/current").root,
      prefix: "/",
      fragment: "",
    })
    expect(mentionFileSearch("/etc/nginx/fra", "/project/current", "/home/user")).toEqual({
      directory: path.resolve(path.parse("/project/current").root, "etc/nginx"),
      prefix: "/etc/nginx/",
      fragment: "fra",
    })
  })

  test("resolves parent queries against the current location", () => {
    expect(mentionFileSearch("..", "/project/src", "/home/user")).toEqual({
      directory: path.resolve("/project"),
      prefix: "../",
      fragment: "",
    })
    expect(mentionFileSearch("../", "/project/src", "/home/user")).toEqual({
      directory: path.resolve("/project"),
      prefix: "../",
      fragment: "",
    })
    expect(mentionFileSearch("../sib/fra", "/project/src", "/home/user")).toEqual({
      directory: path.resolve("/project/sib"),
      prefix: "../sib/",
      fragment: "fra",
    })
    expect(mentionFileSearch("../..", "/project/src/lib", "/home/user")).toEqual({
      directory: path.resolve("/project"),
      prefix: "../../",
      fragment: "",
    })
  })

  test("returns undefined for in-location queries", () => {
    expect(mentionFileSearch("", "/project/current", "/home/user")).toBeUndefined()
    expect(mentionFileSearch("file", "/project/current", "/home/user")).toBeUndefined()
    expect(mentionFileSearch("src/file", "/project/current", "/home/user")).toBeUndefined()
    expect(mentionFileSearch("./file", "/project/current", "/home/user")).toBeUndefined()
  })

  test("does not treat a bare tilde prefix as an outside query", () => {
    expect(mentionFileSearch("~foo", "/project/current", "/home/user")).toBeUndefined()
    expect(mentionFileSearch("~foo/bar", "/project/current", "/home/user")).toBeUndefined()
  })
})

type MentionFixture = { absolute: string; type: "file" | "directory" }

function mentionList(location: { directory: string }, entries: MentionFixture[]) {
  const calls: unknown[] = []
  const file = {
    list: async (input: unknown) => {
      const request = input as { path?: string }
      calls.push(request)
      const requested = path.resolve(location.directory, request.path ?? ".")
      return {
        location: {
          directory: location.directory,
          project: { id: "proj_test", directory: location.directory, canonical: location.directory },
        },
        data: entries
          .filter((entry) => path.dirname(path.resolve(entry.absolute)) === requested)
          .map((entry) => ({
            path:
              (path.relative(location.directory, path.resolve(entry.absolute)) || ".") +
              (entry.type === "directory" ? path.sep : ""),
            type: entry.type,
          })),
      }
    },
  } as Parameters<typeof mentionAutocomplete>[0]
  return { file, calls }
}

function mentionEntry(location: { directory: string }, absolute: string, type: "file" | "directory") {
  const resolved = path.resolve(absolute)
  return {
    path: (path.relative(location.directory, resolved) || ".") + (type === "directory" ? path.sep : ""),
    absolute: resolved,
    name: path.basename(resolved),
    directory: type === "directory",
  }
}

describe("mentionAutocomplete", () => {
  test("lists the client home for home mentions", async () => {
    const location = { directory: "/project/current" }
    const { file, calls } = mentionList(location, [
      { absolute: "/home/user/notes.md", type: "file" },
      { absolute: "/home/user/docs", type: "directory" },
      { absolute: "/home/user/docs/guide.md", type: "file" },
    ])

    expect(await mentionAutocomplete(file, location, "~/", "/home/user", 20)).toEqual({
      search: { directory: "/home/user", prefix: "~/", fragment: "" },
      entries: [
        mentionEntry(location, "/home/user/docs", "directory"),
        mentionEntry(location, "/home/user/notes.md", "file"),
      ],
    })
    expect(await mentionAutocomplete(file, location, "~/notes", "/home/user", 20)).toEqual({
      search: { directory: "/home/user", prefix: "~/", fragment: "notes" },
      entries: [mentionEntry(location, "/home/user/notes.md", "file")],
    })
    expect(await mentionAutocomplete(file, location, "~/docs/", "/home/user", 20)).toEqual({
      search: { directory: path.resolve("/home/user/docs"), prefix: "~/docs/", fragment: "" },
      entries: [mentionEntry(location, "/home/user/docs/guide.md", "file")],
    })
    expect(calls).toEqual([
      { location, path: "/home/user" },
      { location, path: "/home/user" },
      { location, path: path.resolve("/home/user/docs") },
    ])
  })

  test("resolves the sibling base before listing", async () => {
    const location = { directory: "/project/current" }
    const { file, calls } = mentionList(location, [
      { absolute: "/project/sibling/other.ts", type: "file" },
      { absolute: "/project/sibling/notes.md", type: "file" },
    ])
    const directory = path.resolve("/project/sibling")

    expect(await mentionAutocomplete(file, location, "../sibling/oth", "/home/user", 20)).toEqual({
      search: { directory, prefix: "../sibling/", fragment: "oth" },
      entries: [mentionEntry(location, "/project/sibling/other.ts", "file")],
    })
    expect(calls).toEqual([{ location, path: directory }])
  })

  test("hides dot entries unless the fragment starts with a dot", async () => {
    const location = { directory: "/project/current" }
    const { file } = mentionList(location, [
      { absolute: "/project/.git", type: "directory" },
      { absolute: "/project/.env", type: "file" },
      { absolute: "/project/README.md", type: "file" },
    ])
    const directory = path.resolve("/project")

    expect(await mentionAutocomplete(file, location, "..", "/home/user", 20)).toEqual({
      search: { directory, prefix: "../", fragment: "" },
      entries: [mentionEntry(location, "/project/README.md", "file")],
    })
    expect(await mentionAutocomplete(file, location, "../.g", "/home/user", 20)).toEqual({
      search: { directory, prefix: "../", fragment: ".g" },
      entries: [mentionEntry(location, "/project/.git", "directory")],
    })
  })

  test("sorts directories first and respects the limit for an empty fragment", async () => {
    const location = { directory: "/project/current" }
    const { file } = mentionList(location, [
      { absolute: "/project/zeta.txt", type: "file" },
      { absolute: "/project/alpha", type: "directory" },
      { absolute: "/project/beta", type: "directory" },
      { absolute: "/project/amber.txt", type: "file" },
    ])
    const search = { directory: path.resolve("/project"), prefix: "../", fragment: "" }

    expect(await mentionAutocomplete(file, location, "..", "/home/user", 20)).toEqual({
      search,
      entries: [
        mentionEntry(location, "/project/alpha", "directory"),
        mentionEntry(location, "/project/beta", "directory"),
        mentionEntry(location, "/project/amber.txt", "file"),
        mentionEntry(location, "/project/zeta.txt", "file"),
      ],
    })
    expect(await mentionAutocomplete(file, location, "..", "/home/user", 2)).toEqual({
      search,
      entries: [
        mentionEntry(location, "/project/alpha", "directory"),
        mentionEntry(location, "/project/beta", "directory"),
      ],
    })
  })

  test("fuzzy-matches entry names for a fragment", async () => {
    const location = { directory: "/project/current" }
    const { file } = mentionList(location, [
      { absolute: "/project/alpha/report.pdf", type: "file" },
      { absolute: "/project/alpha/README.md", type: "file" },
    ])

    expect(await mentionAutocomplete(file, location, "../alpha/rep", "/home/user", 20)).toEqual({
      search: { directory: path.resolve("/project/alpha"), prefix: "../alpha/", fragment: "rep" },
      entries: [mentionEntry(location, "/project/alpha/report.pdf", "file")],
    })
  })

  test("names the location entry from its absolute path", async () => {
    const location = { directory: "/project/current" }
    const { file } = mentionList(location, [{ absolute: location.directory, type: "directory" }])

    const result = await mentionAutocomplete(file, location, "..", "/home/user", 20)

    // The location itself is returned as "./", so its name must come from the absolute path.
    expect(result?.entries[0]?.path).toBe("." + path.sep)
    expect(result?.entries).toEqual([mentionEntry(location, location.directory, "directory")])
    expect(result?.entries[0]?.name).toBe("current")
  })

  test("returns undefined for in-location queries", async () => {
    const location = { directory: "/project/current" }
    const { file, calls } = mentionList(location, [])

    expect(await mentionAutocomplete(file, location, "src/file", "/home/user", 20)).toBeUndefined()
    expect(calls).toEqual([])
  })
})

describe("mentionFileName", () => {
  test("uses the entry's own basename instead of the relative path", () => {
    // The location's parent is returned as `../`, so basename("../") would render as "..".
    expect(mentionFileName("/", "/home", true)).toBe("/home/")
    expect(mentionFileName("../", "/project/sibling", true)).toBe("../sibling/")
    expect(mentionFileName("~/", "/home/user/notes.md", false)).toBe("~/notes.md")
  })
})
