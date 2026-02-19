import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Glob } from "../../src/util/glob"
import { tmpdir } from "../fixture/fixture"

describe("glob", () => {
  describe("glob()", () => {
    test("finds files matching pattern", async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, "test.txt"), "content", "utf-8")
      await fs.writeFile(path.join(tmp.path, "other.txt"), "content", "utf-8")
      await fs.writeFile(path.join(tmp.path, "skip.md"), "content", "utf-8")

      const results = await Glob.scan("*.txt", { cwd: tmp.path })

      expect(results.sort()).toEqual(["other.txt", "test.txt"])
    })

    test("returns absolute paths when absolute option is true", async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, "test.txt"), "content", "utf-8")

      const results = await Glob.scan("*.txt", { cwd: tmp.path, absolute: true })

      expect(results[0]).toStartWith(tmp.path)
      expect(path.isAbsolute(results[0])).toBe(true)
    })

    test("filters to only files when include is 'file'", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "subdir"))
      await fs.writeFile(path.join(tmp.path, "file.txt"), "content", "utf-8")

      const results = await Glob.scan("*", { cwd: tmp.path, include: "file" })

      expect(results).toEqual(["file.txt"])
    })

    test("includes both files and directories when include is 'all'", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "subdir"))
      await fs.writeFile(path.join(tmp.path, "file.txt"), "content", "utf-8")

      const results = await Glob.scan("*", { cwd: tmp.path, include: "all" })

      expect(results.sort()).toEqual(["file.txt", "subdir"])
    })

    test("handles nested patterns", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "nested"), { recursive: true })
      await fs.writeFile(path.join(tmp.path, "nested", "deep.txt"), "content", "utf-8")

      const results = await Glob.scan("**/*.txt", { cwd: tmp.path })

      expect(results).toEqual(["nested/deep.txt"])
    })

    test("returns empty array for no matches", async () => {
      await using tmp = await tmpdir()

      const results = await Glob.scan("*.nonexistent", { cwd: tmp.path })

      expect(results).toEqual([])
    })
  })

  describe("match()", () => {
    test("matches simple patterns", () => {
      expect(Glob.match("*.txt", "file.txt")).toBe(true)
      expect(Glob.match("*.txt", "file.js")).toBe(false)
    })

    test("matches directory patterns", () => {
      expect(Glob.match("**/*.js", "src/index.js")).toBe(true)
      expect(Glob.match("**/*.js", "src/index.ts")).toBe(false)
    })

    test("matches dot files", () => {
      expect(Glob.match(".*", ".gitignore")).toBe(true)
      expect(Glob.match("**/*.md", ".github/README.md")).toBe(true)
    })

    test("matches brace expansion", () => {
      expect(Glob.match("*.{js,ts}", "file.js")).toBe(true)
      expect(Glob.match("*.{js,ts}", "file.ts")).toBe(true)
      expect(Glob.match("*.{js,ts}", "file.py")).toBe(false)
    })
  })
})
