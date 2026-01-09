import { test, expect, describe } from "bun:test"
import { $ } from "bun"
import path from "path"
import * as fs from "fs/promises"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

describe("Filesystem.contains (lexical)", () => {
  test("allows paths within project", () => {
    expect(Filesystem.contains("/project", "/project/src")).toBe(true)
    expect(Filesystem.contains("/project", "/project/src/file.ts")).toBe(true)
    expect(Filesystem.contains("/project", "/project")).toBe(true)
  })

  test("blocks ../ traversal", () => {
    expect(Filesystem.contains("/project", "/project/../etc")).toBe(false)
    expect(Filesystem.contains("/project", "/project/src/../../etc")).toBe(false)
    expect(Filesystem.contains("/project", "/etc/passwd")).toBe(false)
  })

  test("blocks absolute paths outside project", () => {
    expect(Filesystem.contains("/project", "/etc/passwd")).toBe(false)
    expect(Filesystem.contains("/project", "/tmp/file")).toBe(false)
    expect(Filesystem.contains("/home/user/project", "/home/user/other")).toBe(false)
  })

  test("handles prefix collision edge cases", () => {
    expect(Filesystem.contains("/project", "/project-other/file")).toBe(false)
    expect(Filesystem.contains("/project", "/projectfile")).toBe(false)
  })
})

describe("Filesystem.containsResolved (with symlink resolution)", () => {
  test("allows regular paths within project", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "file.txt"), "content")
        await fs.mkdir(path.join(dir, "subdir"), { recursive: true })
        await Bun.write(path.join(dir, "subdir/nested.txt"), "nested")
      },
    })

    expect(Filesystem.containsResolved(tmp.path, path.join(tmp.path, "file.txt"))).toBe(true)
    expect(Filesystem.containsResolved(tmp.path, path.join(tmp.path, "subdir"))).toBe(true)
    expect(Filesystem.containsResolved(tmp.path, path.join(tmp.path, "subdir/nested.txt"))).toBe(true)
  })

  test("blocks symlink pointing outside project", async () => {
    await using tmp = await tmpdir()

    // Create a symlink inside project pointing to /etc
    const symlinkPath = path.join(tmp.path, "escape-link")
    await $`ln -s /etc ${symlinkPath}`.quiet()

    // Lexical check would pass (symlink path is inside project)
    expect(Filesystem.contains(tmp.path, symlinkPath)).toBe(true)

    // Resolved check should FAIL (symlink resolves to /etc)
    expect(Filesystem.containsResolved(tmp.path, symlinkPath)).toBe(false)
  })

  test("blocks symlink to specific file outside project", async () => {
    await using tmp = await tmpdir()

    // Create symlink to /etc/passwd
    const symlinkPath = path.join(tmp.path, "passwd-link")
    await $`ln -s /etc/passwd ${symlinkPath}`.quiet()

    // Lexical passes, resolved fails
    expect(Filesystem.contains(tmp.path, symlinkPath)).toBe(true)
    expect(Filesystem.containsResolved(tmp.path, symlinkPath)).toBe(false)
  })

  test("allows symlink pointing within project", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "target.txt"), "target content")
      },
    })

    // Create symlink pointing to file within same project
    const symlinkPath = path.join(tmp.path, "internal-link")
    await $`ln -s ${path.join(tmp.path, "target.txt")} ${symlinkPath}`.quiet()

    // Both should pass
    expect(Filesystem.contains(tmp.path, symlinkPath)).toBe(true)
    expect(Filesystem.containsResolved(tmp.path, symlinkPath)).toBe(true)
  })

  test("blocks nested symlink escape", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "subdir"), { recursive: true })
      },
    })

    // Create symlink in subdir pointing outside
    const symlinkPath = path.join(tmp.path, "subdir", "escape")
    await $`ln -s /tmp ${symlinkPath}`.quiet()

    expect(Filesystem.contains(tmp.path, symlinkPath)).toBe(true)
    expect(Filesystem.containsResolved(tmp.path, symlinkPath)).toBe(false)
  })

  test("handles non-existent target (new file in valid dir)", async () => {
    await using tmp = await tmpdir()

    // New file that doesn't exist yet, in a valid directory
    const newFilePath = path.join(tmp.path, "new-file.txt")

    // Should allow - parent directory exists and is valid
    expect(Filesystem.containsResolved(tmp.path, newFilePath)).toBe(true)
  })

  test("handles non-existent target in non-existent subdir", async () => {
    await using tmp = await tmpdir()

    // New file in a directory that also doesn't exist
    const newFilePath = path.join(tmp.path, "new-dir", "new-file.txt")

    // Falls back to lexical check - safe because symlink can't exist
    expect(Filesystem.containsResolved(tmp.path, newFilePath)).toBe(true)
  })

  test("blocks path traversal via ../ even without symlinks", async () => {
    await using tmp = await tmpdir()

    const traversalPath = path.join(tmp.path, "..", "etc", "passwd")
    expect(Filesystem.containsResolved(tmp.path, traversalPath)).toBe(false)
  })

  test("handles relative symlink that escapes", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "deep", "nested"), { recursive: true })
      },
    })

    // Create relative symlink that escapes: deep/nested/escape -> ../../../etc
    const symlinkPath = path.join(tmp.path, "deep", "nested", "escape")
    const result = await $`ln -s ../../../etc ${symlinkPath}`.quiet().nothrow()

    // Skip test if symlink creation failed (some CI environments restrict this)
    if (result.exitCode !== 0) {
      console.log("Skipping relative symlink test - symlink creation failed")
      return
    }

    // Symlink should be blocked because it escapes the project
    expect(Filesystem.containsResolved(tmp.path, symlinkPath)).toBe(false)
  })
})

describe("Filesystem.containsResolved edge cases", () => {
  test("handles broken symlink (target doesn't exist)", async () => {
    await using tmp = await tmpdir()

    // Create symlink to non-existent path outside project
    const symlinkPath = path.join(tmp.path, "broken-link")
    await $`ln -s /nonexistent/path/that/does/not/exist ${symlinkPath}`.quiet()

    // realpathSync will throw for broken symlink - should return false
    expect(Filesystem.containsResolved(tmp.path, symlinkPath)).toBe(false)
  })

  test("handles circular symlinks", async () => {
    await using tmp = await tmpdir()

    // Try to create circular symlink (may fail on some systems)
    const symlinkPath = path.join(tmp.path, "circular")
    const result = await $`ln -s ${symlinkPath} ${symlinkPath}`.quiet().nothrow()

    // Skip test if symlink creation failed
    if (result.exitCode !== 0) {
      console.log("Skipping circular symlink test - symlink creation failed")
      return
    }

    // Should not throw - the key security property is no exceptions
    // Note: circular symlinks pointing to themselves are treated as "broken"
    // and their target is checked. A self-referential symlink like "circular -> circular"
    // resolves to the same directory, so it's considered "contained" (doesn't escape).
    expect(() => Filesystem.containsResolved(tmp.path, symlinkPath)).not.toThrow()
  })

  test("handles symlink chain that eventually escapes", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "file.txt"), "content")
      },
    })

    // link1 -> link2 -> /etc
    const link2 = path.join(tmp.path, "link2")
    const link1 = path.join(tmp.path, "link1")
    await $`ln -s /etc ${link2}`.quiet()
    await $`ln -s ${link2} ${link1}`.quiet()

    // Both should be blocked - realpathSync follows the full chain
    expect(Filesystem.containsResolved(tmp.path, link1)).toBe(false)
    expect(Filesystem.containsResolved(tmp.path, link2)).toBe(false)
  })

  test("handles symlink chain that stays internal", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "target.txt"), "content")
      },
    })

    // link1 -> link2 -> target.txt (all internal)
    const target = path.join(tmp.path, "target.txt")
    const link2 = path.join(tmp.path, "link2")
    const link1 = path.join(tmp.path, "link1")
    await $`ln -s ${target} ${link2}`.quiet()
    await $`ln -s ${link2} ${link1}`.quiet()

    // Both should be allowed
    expect(Filesystem.containsResolved(tmp.path, link1)).toBe(true)
    expect(Filesystem.containsResolved(tmp.path, link2)).toBe(true)
  })
})
