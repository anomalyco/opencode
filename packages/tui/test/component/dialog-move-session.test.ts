import { describe, expect, test } from "bun:test"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { expandHome, canonicalDirectory, autocompleteDirectories } from "../../src/component/dialog-move-session"

describe("dialog move session", () => {
  const fakeHome = process.platform === "win32" ? "C:\\Users\\tester" : "/home/tester"

  test("expandHome expands bare ~ to home directory", () => {
    expect(expandHome("~", fakeHome)).toBe(fakeHome)
  })

  test("expandHome expands ~/path to home-relative path", () => {
    const expected = path.join(fakeHome, "workspace", "project")
    expect(expandHome("~/workspace/project", fakeHome)).toBe(expected)
    if (process.platform === "win32") {
      expect(expandHome("~\\workspace\\project", fakeHome)).toBe(expected)
    }
  })

  test("expandHome leaves standard absolute paths untouched", () => {
    const absPath = process.platform === "win32" ? "C:\\work\\repo" : "/work/repo"
    expect(expandHome(absPath, fakeHome)).toBe(path.resolve(absPath))
  })

  test("canonicalDirectory normalizes real directory casing on disk", () => {
    const cwd = process.cwd()
    const lower = cwd.toLowerCase()
    const canonical = canonicalDirectory(lower, os.homedir())
    expect(canonical.toLowerCase()).toBe(cwd.toLowerCase())
    if (process.platform === "win32") {
      // Confirms drive letter is uppercase and directory matches realpath
      expect(canonical[0]).toBe(canonical[0]?.toUpperCase())
    }
  })

  test("autocompleteDirectories discovers subdirectories matching path input", () => {
    const testDir = path.join(os.tmpdir(), `auto-test-${Date.now()}`)
    fs.mkdirSync(path.join(testDir, "alpha"), { recursive: true })
    fs.mkdirSync(path.join(testDir, "beta"), { recursive: true })
    fs.mkdirSync(path.join(testDir, ".hidden"), { recursive: true })

    try {
      const all = autocompleteDirectories(testDir, os.homedir())
      expect(all.length).toBe(2)
      expect(all.some((d) => d.includes("alpha"))).toBe(true)
      expect(all.some((d) => d.includes("beta"))).toBe(true)
      expect(all.some((d) => d.includes(".hidden"))).toBe(false)

      const partial = autocompleteDirectories(path.join(testDir, "al"), os.homedir())
      expect(partial.length).toBe(1)
      expect(partial[0]?.includes("alpha")).toBe(true)

      const withSlash = autocompleteDirectories(testDir + path.sep, os.homedir())
      expect(withSlash.length).toBe(2)
      // Check alphabetical ordering
      const sorted = [...withSlash].sort((a, b) => a.localeCompare(b))
      expect(withSlash).toEqual(sorted)
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })
})
