import { describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { Filesystem } from "../../src/util/filesystem"

describe("util.filesystem", () => {
  test("exists() is true for files and directories", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const dir = path.join(tmp, "dir")
    const file = path.join(tmp, "file.txt")
    const missing = path.join(tmp, "missing")

    await mkdir(dir, { recursive: true })
    await Bun.write(file, "hello")

    const cases = await Promise.all([Filesystem.exists(dir), Filesystem.exists(file), Filesystem.exists(missing)])

    expect(cases).toEqual([true, true, false])

    await rm(tmp, { recursive: true, force: true })
  })

  test("isDir() is true only for directories", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const dir = path.join(tmp, "dir")
    const file = path.join(tmp, "file.txt")
    const missing = path.join(tmp, "missing")

    await mkdir(dir, { recursive: true })
    await Bun.write(file, "hello")

    const cases = await Promise.all([Filesystem.isDir(dir), Filesystem.isDir(file), Filesystem.isDir(missing)])

    expect(cases).toEqual([true, false, false])

    await rm(tmp, { recursive: true, force: true })
  })

  describe("sanitizePath", () => {
    test("returns unchanged path when valid", () => {
      const result: Filesystem.SanitizeResult = Filesystem.sanitizePath("/valid/path")
      expect(result.path).toBe("/valid/path")
      expect(result.warnings).toEqual([])
    })

    test("trims trailing whitespace and warns", () => {
      const result: Filesystem.SanitizeResult = Filesystem.sanitizePath("/path/with/trailing ")
      expect(result.path).toBe("/path/with/trailing")
      expect(result.warnings).toContain("Path has trailing whitespace")
    })

    test("trims leading whitespace and warns", () => {
      const result: Filesystem.SanitizeResult = Filesystem.sanitizePath(" /path/with/leading")
      expect(result.path).toBe("/path/with/leading")
      expect(result.warnings).toContain("Path has leading whitespace")
    })

    test("removes null bytes and warns", () => {
      const result: Filesystem.SanitizeResult = Filesystem.sanitizePath("/path\0with\0nulls")
      expect(result.path).toBe("/pathwithnulls")
      expect(result.warnings).toContain("Path contains null bytes")
    })

    test("handles multiple issues", () => {
      const result: Filesystem.SanitizeResult = Filesystem.sanitizePath(" /path\0name ")
      expect(result.path).toBe("/pathname")
      expect(result.warnings.length).toBe(3)
      expect(result.warnings).toContain("Path contains null bytes")
      expect(result.warnings).toContain("Path has leading whitespace")
      expect(result.warnings).toContain("Path has trailing whitespace")
    })

    test("warns when path is empty after sanitization", () => {
      const result: Filesystem.SanitizeResult = Filesystem.sanitizePath("   ")
      expect(result.path).toBe("")
      expect(result.warnings).toContain("Path is empty after sanitization")
    })

    test("handles empty string input", () => {
      const result: Filesystem.SanitizeResult = Filesystem.sanitizePath("")
      expect(result.path).toBe("")
      expect(result.warnings).toContain("Path is empty after sanitization")
    })

    test("handles tabs and newlines as whitespace", () => {
      const result: Filesystem.SanitizeResult = Filesystem.sanitizePath("\t/path\n")
      expect(result.path).toBe("/path")
      expect(result.warnings).toContain("Path has leading whitespace")
      expect(result.warnings).toContain("Path has trailing whitespace")
    })

    test("does not modify internal spaces", () => {
      const result: Filesystem.SanitizeResult = Filesystem.sanitizePath("/path/with spaces/inside")
      expect(result.path).toBe("/path/with spaces/inside")
      expect(result.warnings).toEqual([])
    })
  })
})
