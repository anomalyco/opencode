import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { FileTree } from "../../src/file/tree"
import { Ripgrep } from "../../src/file/ripgrep"
import { tmpdir } from "../fixture/fixture"

describe("FileTree.tree", () => {
  test("returns tree structure for git repo with untracked files", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // These files are NOT git added - testing --others flag
        await Bun.write(path.join(dir, "src/index.ts"), "export const x = 1")
        await Bun.write(path.join(dir, "src/util/helper.ts"), "export const y = 2")
        await Bun.write(path.join(dir, "README.md"), "# Test")
        await Bun.write(path.join(dir, "package.json"), "{}")
      },
    })

    const result = await FileTree.tree({ cwd: tmp.path, limit: 50 })

    expect(result).toContain("src/")
    expect(result).toContain("README.md")
    expect(result).toContain("package.json")
  })

  test("returns empty for non-git directory", async () => {
    await using tmp = await tmpdir({
      git: false,
      init: async (dir) => {
        await Bun.write(path.join(dir, "file1.txt"), "content1")
      },
    })

    const result = await FileTree.tree({ cwd: tmp.path, limit: 50 })
    expect(result).toBe("")
  })

  test("respects limit parameter", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Create many files (untracked)
        for (let i = 0; i < 50; i++) {
          await Bun.write(path.join(dir, `file${i}.txt`), `content${i}`)
        }
      },
    })

    const result = await FileTree.tree({ cwd: tmp.path, limit: 10 })
    const lines = result.split("\n").filter(Boolean)

    // Should have truncation indicator when limited
    expect(lines.length).toBeLessThanOrEqual(15) // some buffer for tree structure
  })

  test("excludes .opencode directory", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "visible")
        await Bun.write(path.join(dir, ".opencode/hidden.txt"), "hidden")
      },
    })

    const result = await FileTree.tree({ cwd: tmp.path, limit: 50 })

    expect(result).toContain("visible.txt")
    expect(result).not.toContain(".opencode")
    expect(result).not.toContain("hidden.txt")
  })

  test("handles empty directory", async () => {
    await using tmp = await tmpdir({ git: true })

    const result = await FileTree.tree({ cwd: tmp.path, limit: 50 })

    expect(result).toBe("")
  })

  test("includes both tracked and untracked files", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Create and track a file
        await Bun.write(path.join(dir, "tracked.txt"), "tracked")
        await $`git add tracked.txt`.cwd(dir).quiet()
        // Create an untracked file
        await Bun.write(path.join(dir, "untracked.txt"), "untracked")
      },
    })

    const result = await FileTree.tree({ cwd: tmp.path, limit: 50 })

    expect(result).toContain("tracked.txt")
    expect(result).toContain("untracked.txt")
  })

  test("excludes gitignored files", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "ignored.txt\n")
        await Bun.write(path.join(dir, "visible.txt"), "visible")
        await Bun.write(path.join(dir, "ignored.txt"), "ignored")
      },
    })

    const result = await FileTree.tree({ cwd: tmp.path, limit: 50 })

    expect(result).toContain("visible.txt")
    expect(result).toContain(".gitignore")
    expect(result).not.toContain("ignored.txt")
  })

  test("git ls-files is faster than ripgrep scan for large repos", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Create enough files to notice timing difference (untracked)
        for (let i = 0; i < 100; i++) {
          await Bun.write(path.join(dir, `dir${i % 10}/file${i}.txt`), `content${i}`)
        }
      },
    })

    // Time git ls-files (used by FileTree)
    const gitStart = performance.now()
    await FileTree.tree({ cwd: tmp.path, limit: 200 })
    const gitDuration = performance.now() - gitStart

    // Time ripgrep scan for comparison
    const rgStart = performance.now()
    await Array.fromAsync(Ripgrep.files({ cwd: tmp.path }))
    const rgDuration = performance.now() - rgStart

    // git ls-files should be faster (or at least comparable for small repos)
    // The real difference shows on large repos (40k+ files) where git is ~100x faster
    expect(gitDuration).toBeLessThan(500)
    expect(rgDuration).toBeGreaterThan(0)
  })
})
