import { describe, expect, test } from "bun:test"
import path from "path"
import type { KeymapCommand } from "@opencode-ai/plugin/tui/context"
import {
  directoryAutocomplete,
  directoryAutocompleteExactValue,
  directoryAutocompleteMatches,
  directoryAutocompleteResultValue,
  directoryAutocompleteSearch,
  directoryRecentValue,
  slashArgumentAutocomplete,
} from "../../src/prompt/directory-completion"

describe("directoryAutocomplete", () => {
  test("lists parents and siblings through the current workspace without changing location", async () => {
    const location = { directory: "/project/current", workspace: "workspace_1" }
    const calls: unknown[] = []
    const file = {
      list: async (input: unknown) => {
        calls.push(input)
        return {
          location: { directory: location.directory, workspaceID: location.workspace },
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
    const location = { directory: "/project/current", workspace: "workspace_1" }
    const calls: unknown[] = []
    const file = {
      list: async (input: unknown) => {
        calls.push(input)
        return {
          location: { directory: location.directory },
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
  test("starts after the command separator", () => {
    expect(slashArgumentAutocomplete("/cd ", 4, commands, argumentAutocomplete)).toEqual({
      type: "directory",
      index: 4,
    })
    expect(slashArgumentAutocomplete("/cd src", 7, commands, argumentAutocomplete)).toEqual({
      type: "directory",
      index: 4,
    })
  })

  test("supports aliases", () => {
    expect(slashArgumentAutocomplete("/chdir src", 10, commands, argumentAutocomplete)).toEqual({
      type: "directory",
      index: 7,
    })
  })

  test("does not complete the command token", () => {
    expect(slashArgumentAutocomplete("/cd", 3, commands, argumentAutocomplete)).toBeUndefined()
    expect(slashArgumentAutocomplete("/other ", 7, commands, argumentAutocomplete)).toBeUndefined()
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
