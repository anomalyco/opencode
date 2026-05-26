import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import { resolveThreadDirectory } from "../../../src/cli/cmd/tui"
import { Filesystem } from "../../../src/util/filesystem"

describe("tui thread", () => {
  test("loads the TUI integration lazily", async () => {
    const source = await Bun.file(new URL("../../../src/cli/cmd/tui.ts", import.meta.url)).text()

    expect(source).toContain('await import("../tui/layer")')
    expect(source).toMatch(/await import\(["']@\/plugin\/tui\/runtime["']\)/)
    expect(source).not.toContain('import("./app")')
  })

  async function check(project?: string) {
    await using tmp = await tmpdir({ git: true })
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    const type = process.platform === "win32" ? "junction" : "dir"

    try {
      await fs.symlink(tmp.path, link, type)
      expect(resolveThreadDirectory(project, link, tmp.path)).toBe(tmp.path)
    } finally {
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  test("uses the real cwd when PWD points at a symlink", async () => {
    await check()
  })

  test("uses the real cwd after resolving a relative project from PWD", async () => {
    await check(".")
  })
})

describe("safe path handling", () => {
  test("isAbsolutePath returns false for numeric input", () => {
    expect(Filesystem.isAbsolutePath(123 as any)).toBe(false)
  })

  test("isAbsolutePath returns false for null", () => {
    expect(Filesystem.isAbsolutePath(null as any)).toBe(false)
  })

  test("isAbsolutePath returns false for undefined", () => {
    expect(Filesystem.isAbsolutePath(undefined as any)).toBe(false)
  })

  test("isAbsolutePath returns false for object", () => {
    expect(Filesystem.isAbsolutePath({} as any)).toBe(false)
  })

  test("isAbsolutePath returns true for absolute path strings", () => {
    const abs = process.platform === "win32" ? "C:\\Users" : "/usr"
    expect(Filesystem.isAbsolutePath(abs)).toBe(true)
  })

  test("isAbsolutePath returns false for relative path strings", () => {
    expect(Filesystem.isAbsolutePath("relative/path")).toBe(false)
  })

  test("resolveThreadDirectory handles numeric project gracefully", () => {
    const cwd = process.cwd()
    const result = resolveThreadDirectory(42 as any, cwd, cwd)
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })

  test("resolveThreadDirectory handles null project gracefully", () => {
    const cwd = process.cwd()
    const result = resolveThreadDirectory(null as any, cwd, cwd)
    expect(typeof result).toBe("string")
    expect(result).toBe(Filesystem.resolve(cwd))
  })
})
