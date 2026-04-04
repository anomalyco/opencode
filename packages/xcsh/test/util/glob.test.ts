import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Glob } from "../../src/util/glob"
import { tmpdir } from "../fixture/fixture"

describe("Glob", () => {
  describe("scan()", () => {
    test("finds files matching pattern", async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, "a.txt"), "", "utf-8")
      await fs.writeFile(path.join(tmp.path, "b.txt"), "", "utf-8")
      await fs.writeFile(path.join(tmp.path, "c.md"), "", "utf-8")

      const results = await Glob.scan("*.txt", { cwd: tmp.path })

      expect(results.sort()).toEqual(["a.txt", "b.txt"])
    })

    test("returns absolute paths when absolute option is true", async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, "file.txt"), "", "utf-8")

      const results = await Glob.scan("*.txt", { cwd: tmp.path, absolute: true })

      expect(results[0]).toBe(path.join(tmp.path, "file.txt"))
    })

    test("excludes directories by default", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "subdir"))
      await fs.writeFile(path.join(tmp.path, "file.txt"), "", "utf-8")

      const results = await Glob.scan("*", { cwd: tmp.path })

      expect(results).toEqual(["file.txt"])
    })

    test("excludes directories when include is 'file'", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "subdir"))
      await fs.writeFile(path.join(tmp.path, "file.txt"), "", "utf-8")

      const results = await Glob.scan("*", { cwd: tmp.path, include: "file" })

      expect(results).toEqual(["file.txt"])
    })

    test("includes directories when include is 'all'", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "subdir"))
      await fs.writeFile(path.join(tmp.path, "file.txt"), "", "utf-8")

      const results = await Glob.scan("*", { cwd: tmp.path, include: "all" })

      expect(results.sort()).toEqual(["file.txt", "subdir"])
    })

    test("handles nested patterns", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "nested"), { recursive: true })
      await fs.writeFile(path.join(tmp.path, "nested", "deep.txt"), "", "utf-8")

      const results = await Glob.scan("**/*.txt", { cwd: tmp.path })

      expect(results).toEqual([path.join("nested", "deep.txt")])
    })

    test("returns empty array for no matches", async () => {
      await using tmp = await tmpdir()

      const results = await Glob.scan("*.nonexistent", { cwd: tmp.path })

      expect(results).toEqual([])
    })

    test("does not follow symlinks by default", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "realdir"))
      await fs.writeFile(path.join(tmp.path, "realdir", "file.txt"), "", "utf-8")
      await fs.symlink(path.join(tmp.path, "realdir"), path.join(tmp.path, "linkdir"))

      const results = await Glob.scan("**/*.txt", { cwd: tmp.path })

      expect(results).toEqual([path.join("realdir", "file.txt")])
    })

    test("follows symlinks when symlink option is true", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "realdir"))
      await fs.writeFile(path.join(tmp.path, "realdir", "file.txt"), "", "utf-8")
      await fs.symlink(path.join(tmp.path, "realdir"), path.join(tmp.path, "linkdir"))

      const results = await Glob.scan("**/*.txt", { cwd: tmp.path, symlink: true })

      expect(results.sort()).toEqual([path.join("linkdir", "file.txt"), path.join("realdir", "file.txt")])
    })

    test("includes dotfiles when dot option is true", async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, ".hidden"), "", "utf-8")
      await fs.writeFile(path.join(tmp.path, "visible"), "", "utf-8")

      const results = await Glob.scan("*", { cwd: tmp.path, dot: true })

      expect(results.sort()).toEqual([".hidden", "visible"])
    })

    test("excludes dotfiles when dot option is false", async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, ".hidden"), "", "utf-8")
      await fs.writeFile(path.join(tmp.path, "visible"), "", "utf-8")

      const results = await Glob.scan("*", { cwd: tmp.path, dot: false })

      expect(results).toEqual(["visible"])
    })
  })

  describe("scanSync()", () => {
    test("finds files matching pattern synchronously", async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, "a.txt"), "", "utf-8")
      await fs.writeFile(path.join(tmp.path, "b.txt"), "", "utf-8")

      const results = Glob.scanSync("*.txt", { cwd: tmp.path })

      expect(results.sort()).toEqual(["a.txt", "b.txt"])
    })

    test("respects options", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "subdir"))
      await fs.writeFile(path.join(tmp.path, "file.txt"), "", "utf-8")

      const results = Glob.scanSync("*", { cwd: tmp.path, include: "all" })

      expect(results.sort()).toEqual(["file.txt", "subdir"])
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
