import { expect, test } from "bun:test"
import { directoryCompletionMatches, directoryCompletionSearch } from "./directory-completion"

test.each([
  { query: "~", directory: "/home/user", prefix: "~/", search: "" },
  { query: "~/projects/open", directory: "/home/user/projects", prefix: "~/projects/", search: "open" },
  { query: "../../pac", directory: "/project", prefix: "../../", search: "pac" },
  { query: "../../..", directory: "/", prefix: "../../../", search: "" },
  { query: "/usr/lo", directory: "/usr", prefix: "/usr/", search: "lo" },
  { query: "packages/core", directory: "/project/src/lib/packages", prefix: "packages/", search: "core" },
])("$query lists $directory", (row) => {
  expect(directoryCompletionSearch(row.query, "/project/src/lib", "/home/user")).toEqual({
    directory: row.directory,
    prefix: row.prefix,
    query: row.search,
  })
})

test("a Windows session lists absolute paths from its own drive", () => {
  expect(directoryCompletionSearch("/Users/a", "C:/work", "C:/Users/me")).toEqual({
    directory: "C:/Users",
    prefix: "/Users/",
    query: "a",
  })
})

test("hidden directories wait for a typed dot", () => {
  expect(directoryCompletionMatches(".git", "")).toBe(false)
  expect(directoryCompletionMatches(".git", ".g")).toBe(true)
  expect(directoryCompletionMatches("Packages", "pack")).toBe(true)
})
