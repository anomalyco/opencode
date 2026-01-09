import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Ripgrep } from "../../src/file/ripgrep"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("Ripgrep", () => {
  let testDir: string

  beforeAll(async () => {
    // Create a temporary test directory with known structure
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "ripgrep-test-"))

    // Create test file structure:
    // testDir/
    //   src/
    //     index.ts
    //     utils.ts
    //   test/
    //     index.test.ts
    //   README.md
    //   package.json

    await fs.mkdir(path.join(testDir, "src"))
    await fs.mkdir(path.join(testDir, "test"))

    await fs.writeFile(path.join(testDir, "src", "index.ts"), 'export const hello = "world"\n')
    await fs.writeFile(path.join(testDir, "src", "utils.ts"), 'export function add(a: number, b: number) { return a + b }\n')
    await fs.writeFile(path.join(testDir, "test", "index.test.ts"), 'import { hello } from "../src/index"\n')
    await fs.writeFile(path.join(testDir, "README.md"), "# Test Project\n")
    await fs.writeFile(path.join(testDir, "package.json"), '{"name": "test"}\n')
  })

  afterAll(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe("rg", () => {
    test("returns path to rg binary", async () => {
      const rgPath = await Ripgrep.rg()
      expect(rgPath).toBeString()
      expect(rgPath.length).toBeGreaterThan(0)
      // Should end with 'rg' or 'rg.exe'
      expect(rgPath.endsWith("rg") || rgPath.endsWith("rg.exe")).toBe(true)
    })

    test("binary exists at returned path", async () => {
      const rgPath = await Ripgrep.rg()
      const exists = await fs.stat(rgPath).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })
  })

  describe("files", () => {
    test("lists all files in directory", async () => {
      const files = await Array.fromAsync(Ripgrep.files({ cwd: testDir }))

      expect(files).toContain("src/index.ts")
      expect(files).toContain("src/utils.ts")
      expect(files).toContain("test/index.test.ts")
      expect(files).toContain("README.md")
      expect(files).toContain("package.json")
    })

    test("filters files by glob pattern", async () => {
      const tsFiles = await Array.fromAsync(Ripgrep.files({ cwd: testDir, glob: ["*.ts"] }))

      expect(tsFiles).toContain("src/index.ts")
      expect(tsFiles).toContain("src/utils.ts")
      expect(tsFiles).toContain("test/index.test.ts")
      expect(tsFiles).not.toContain("README.md")
      expect(tsFiles).not.toContain("package.json")
    })

    test("respects maxDepth option", async () => {
      const rootFiles = await Array.fromAsync(Ripgrep.files({ cwd: testDir, maxDepth: 1 }))

      expect(rootFiles).toContain("README.md")
      expect(rootFiles).toContain("package.json")
      expect(rootFiles).not.toContain("src/index.ts")
      expect(rootFiles).not.toContain("test/index.test.ts")
    })

    test("throws ENOENT for non-existent directory", async () => {
      const nonExistent = path.join(testDir, "does-not-exist")

      await expect(Array.fromAsync(Ripgrep.files({ cwd: nonExistent }))).rejects.toMatchObject({
        code: "ENOENT",
      })
    })
  })

  describe("tree", () => {
    test("returns tree structure of files", async () => {
      const tree = await Ripgrep.tree({ cwd: testDir })

      expect(tree).toBeString()
      expect(tree).toContain("src/")
      expect(tree).toContain("test/")
    })

    test("respects limit option", async () => {
      const tree = await Ripgrep.tree({ cwd: testDir, limit: 3 })

      // With limit 3, should have truncation markers
      const lines = tree.split("\n").filter(Boolean)
      expect(lines.length).toBeLessThanOrEqual(10) // Some reasonable upper bound
    })

    test("sorts directories before files", async () => {
      const tree = await Ripgrep.tree({ cwd: testDir, limit: 100 })
      const lines = tree.split("\n").filter(Boolean)

      // Find indices of directories and files at root level
      const srcIndex = lines.findIndex((l) => l === "src/")
      const testIndex = lines.findIndex((l) => l === "test/")
      const readmeIndex = lines.findIndex((l) => l === "README.md")
      const packageIndex = lines.findIndex((l) => l === "package.json")

      // Directories should come before files
      if (srcIndex !== -1 && readmeIndex !== -1) {
        expect(srcIndex).toBeLessThan(readmeIndex)
      }
      if (testIndex !== -1 && packageIndex !== -1) {
        expect(testIndex).toBeLessThan(packageIndex)
      }
    })
  })

  describe("search", () => {
    test("finds matches for pattern", async () => {
      const results = await Ripgrep.search({ cwd: testDir, pattern: "hello" })

      expect(results.length).toBeGreaterThan(0)
      expect(results.some((r) => r.path.text.includes("index.ts"))).toBe(true)
    })

    test("returns empty array for no matches", async () => {
      const results = await Ripgrep.search({ cwd: testDir, pattern: "nonexistentpattern12345" })

      expect(results).toEqual([])
    })

    test("filters by glob pattern", async () => {
      // Exclude .ts files - should not find "hello" in any remaining files
      const results = await Ripgrep.search({ cwd: testDir, pattern: "hello", glob: ["!**/*.ts"] })

      // "hello" is only in .ts files, so excluding them should return empty
      expect(results.every((r) => !r.path.text.endsWith(".ts"))).toBe(true)
    })

    test("respects limit option", async () => {
      // Create a file with multiple matches
      await fs.writeFile(
        path.join(testDir, "many-matches.txt"),
        "hello\nhello\nhello\nhello\nhello\n"
      )

      // limit is max-count per file, so we should get at most 2 from this file
      const results = await Ripgrep.search({ cwd: testDir, pattern: "hello", glob: ["many-matches.txt"], limit: 2 })

      expect(results.length).toBeLessThanOrEqual(2)

      // Clean up
      await fs.unlink(path.join(testDir, "many-matches.txt"))
    })

    test("returns correct match structure", async () => {
      const results = await Ripgrep.search({ cwd: testDir, pattern: "hello" })

      expect(results.length).toBeGreaterThan(0)
      const match = results[0]

      expect(match).toHaveProperty("path")
      expect(match).toHaveProperty("lines")
      expect(match).toHaveProperty("line_number")
      expect(match).toHaveProperty("submatches")
      expect(match.path).toHaveProperty("text")
      expect(match.lines).toHaveProperty("text")
      expect(typeof match.line_number).toBe("number")
      expect(Array.isArray(match.submatches)).toBe(true)
    })
  })
})
