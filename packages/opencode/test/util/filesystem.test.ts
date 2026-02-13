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

  test("normalize() normalizes separators to forward slashes", () => {
    if (process.platform === "win32") {
      expect(Filesystem.normalize("C:/foo/bar")).toBe("C:/foo/bar")
      expect(Filesystem.normalize("C:\\foo\\bar")).toBe("C:/foo/bar")
      expect(Filesystem.normalize("/c/foo/bar")).toBe("C:/foo/bar")
      expect(Filesystem.normalize("/cygdrive/c/foo/bar")).toBe("C:/foo/bar")
      expect(Filesystem.normalize("/d/mixed\\path")).toBe("D:/mixed/path")
    } else {
      expect(Filesystem.normalize("/foo/bar")).toBe("/foo/bar")
      expect(Filesystem.normalize("/c/foo/bar")).toBe("/c/foo/bar")
    }
  })

  test("relative() with mixed separators", () => {
    if (process.platform === "win32") {
      expect(Filesystem.relative("C:/foo/bar", "C:/foo/baz")).toMatch(/^\.\./)
      expect(Filesystem.relative("C:\\foo\\bar", "C:\\foo\\bar\\sub")).toMatch(/^sub/)
      expect(Filesystem.relative("C:/foo", "C:/foo/../../etc")).toMatch(/^\.\./)
      expect(Filesystem.relative("C:/foo", "D:/bar")).toMatch(/^D:/)
    } else {
      expect(Filesystem.relative("/foo/bar", "/foo/baz")).toMatch(/^\.\./)
      expect(Filesystem.relative("/foo", "/foo/../etc")).toMatch(/^\.\./)
    }
  })

  test("join() combines path segments", () => {
    const result = Filesystem.join("foo", "bar", "baz.txt")
    // Always uses forward slashes now
    expect(result).toBe("foo/bar/baz.txt")
  })

  test("dirname() returns parent directory", () => {
    expect(Filesystem.dirname(".")).toMatch(/^\.\.?$/)
    if (process.platform === "win32") {
      // Always uses forward slashes now
      expect(Filesystem.dirname("\\")).toBe("/")
      expect(Filesystem.dirname("C:/")).toBe("C:/")
      expect(Filesystem.dirname("C:/file.txt")).toBe("C:/")
    } else {
      expect(Filesystem.dirname("/")).toBe("/")
    }
  })

  test("contains() detects parent-child relationships", () => {
    if (process.platform === "win32") {
      expect(Filesystem.contains("C:/foo", "C:/foo/bar")).toBe(true)
      expect(Filesystem.contains("C:/foo", "D:/foo/bar")).toBe(false)
      expect(Filesystem.contains("C:/foo", "C:/foo/../etc")).toBe(false)
    }
    expect(Filesystem.contains("/foo", "/foo/bar/baz")).toBe(true)
    expect(Filesystem.contains("/foo", "/bar")).toBe(false)
  })

  test("findUp() finds files in parent directories", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const sub = path.join(tmp, "sub", "deep")

    await mkdir(sub, { recursive: true })
    await Bun.write(path.join(tmp, "config.txt"), "root")
    await Bun.write(path.join(tmp, "sub", "config.txt"), "sub")

    const results = await Filesystem.findUp("config.txt", sub)

    expect(results.length).toBe(2)
    expect(results.some((r) => r.includes("sub"))).toBe(true)

    await rm(tmp, { recursive: true, force: true })
  })
})
