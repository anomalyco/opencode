import { test, expect } from "bun:test"
import { Filesystem } from "../../src/util/filesystem"

test("Filesystem.contains blocks parent directory traversal", () => {
  expect(Filesystem.contains("/project", "/project/src")).toBe(true)
  expect(Filesystem.contains("/project", "/project/src/file.ts")).toBe(true)
  expect(Filesystem.contains("/project", "/project")).toBe(true)
})

test("Filesystem.contains blocks ../ traversal", () => {
  expect(Filesystem.contains("/project", "/project/../etc")).toBe(false)
  expect(Filesystem.contains("/project", "/project/src/../../etc")).toBe(false)
  expect(Filesystem.contains("/project", "/etc/passwd")).toBe(false)
})

test("Filesystem.contains blocks absolute paths outside project", () => {
  expect(Filesystem.contains("/project", "/etc/passwd")).toBe(false)
  expect(Filesystem.contains("/project", "/tmp/file")).toBe(false)
  expect(Filesystem.contains("/home/user/project", "/home/user/other")).toBe(false)
})

test("Filesystem.contains handles edge cases", () => {
  expect(Filesystem.contains("/project", "/project-other/file")).toBe(false)
  expect(Filesystem.contains("/project", "/projectfile")).toBe(false)
})
