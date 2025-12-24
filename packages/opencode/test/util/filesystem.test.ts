import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs"
import { Filesystem } from "../../src/util/filesystem"

describe("Filesystem.tmpdir", () => {
  test("returns a resolved path", () => {
    const tmp = Filesystem.tmpdir()
    // Should be an absolute path
    expect(path.isAbsolute(tmp)).toBe(true)
    // Should exist
    expect(fs.existsSync(tmp)).toBe(true)
  })

  test("resolves symlinks", () => {
    const tmp = Filesystem.tmpdir()
    // On macOS, /tmp is a symlink to /private/tmp
    // The resolved path should not be /tmp if it's a symlink
    if (process.platform === "darwin") {
      expect(tmp).not.toBe("/tmp")
      expect(tmp).toContain("/private")
    }
  })
})

describe("Filesystem.isInTmpdir", () => {
  test("returns true for paths in tmpdir", () => {
    const tmp = Filesystem.tmpdir()
    expect(Filesystem.isInTmpdir(path.join(tmp, "test.txt"))).toBe(true)
    expect(Filesystem.isInTmpdir(path.join(tmp, "subdir", "test.txt"))).toBe(true)
  })

  test("returns false for paths outside tmpdir", () => {
    expect(Filesystem.isInTmpdir("/home/user/file.txt")).toBe(false)
    expect(Filesystem.isInTmpdir("/etc/passwd")).toBe(false)
    expect(Filesystem.isInTmpdir("/usr/local/bin")).toBe(false)
  })

  test("handles symlinked tmpdir paths on macOS", () => {
    if (process.platform === "darwin") {
      // os.tmpdir() on macOS returns /var/folders/.../T which resolves to /private/var/folders/.../T
      // We should be able to use either the resolved or unresolved form
      const unresolved = require("os").tmpdir()
      expect(Filesystem.isInTmpdir(path.join(unresolved, "test.txt"))).toBe(true)
    }
  })

  test("returns true for nested non-existent paths in tmpdir", () => {
    const tmp = Filesystem.tmpdir()
    const deepPath = path.join(tmp, "nonexistent", "deeply", "nested", "file.txt")
    expect(Filesystem.isInTmpdir(deepPath)).toBe(true)
  })
})

describe("Filesystem.containsResolved", () => {
  test("returns true when child is within parent", () => {
    const tmp = Filesystem.tmpdir()
    expect(Filesystem.containsResolved(tmp, path.join(tmp, "child.txt"))).toBe(true)
    expect(Filesystem.containsResolved(tmp, path.join(tmp, "subdir", "child.txt"))).toBe(true)
  })

  test("returns false when child is outside parent", () => {
    const tmp = Filesystem.tmpdir()
    expect(Filesystem.containsResolved(tmp, "/etc/passwd")).toBe(false)
    expect(Filesystem.containsResolved(tmp, "/usr/local")).toBe(false)
  })

  test("handles non-existent child paths", () => {
    const tmp = Filesystem.tmpdir()
    const nonExistent = path.join(tmp, "does-not-exist-" + Date.now(), "file.txt")
    expect(Filesystem.containsResolved(tmp, nonExistent)).toBe(true)
  })

  test("handles deeply nested non-existent paths", () => {
    const tmp = Filesystem.tmpdir()
    const deepPath = path.join(tmp, "a", "b", "c", "d", "e", "file.txt")
    expect(Filesystem.containsResolved(tmp, deepPath)).toBe(true)
  })

  test("resolves symlinks in macOS /tmp", () => {
    if (process.platform === "darwin") {
      // /tmp -> /private/tmp on macOS
      const privateTmp = "/private/tmp"
      expect(Filesystem.containsResolved(privateTmp, "/tmp/test.txt")).toBe(true)
    }
  })
})
