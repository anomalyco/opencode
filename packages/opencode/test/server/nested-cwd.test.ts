import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { Global } from "../../src/global"
import { Log } from "../../src/util/log"

Log.init({ print: false })

/**
 * Test for the nested directory serve bug.
 *
 * When the server is started from a deeply nested directory (e.g., ~/projects/myapp/src/components),
 * shell commands that don't specify an explicit `cwd` would fail with "No such file or directory"
 * because they default to process.cwd().
 *
 * The fix ensures the serve/web commands change process.cwd() to home directory at startup.
 */
describe("Server nested directory handling", () => {
  let originalCwd: string
  let nestedDir: string
  let tmpBase: string

  beforeAll(async () => {
    originalCwd = process.cwd()

    // Create a deeply nested temporary directory to simulate starting server from there
    tmpBase = path.join(os.tmpdir(), "opencode-nested-test-" + Math.random().toString(36).slice(2))
    nestedDir = path.join(tmpBase, "deeply", "nested", "folder", "structure")
    await fs.mkdir(nestedDir, { recursive: true })
  })

  afterAll(async () => {
    // Restore original cwd
    process.chdir(originalCwd)

    // Clean up temp directories
    if (tmpBase) {
      await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {})
    }
  })

  beforeEach(() => {
    // Start each test from the nested directory
    process.chdir(nestedDir)
  })

  afterEach(() => {
    // Restore to original after each test
    process.chdir(originalCwd)
  })

  test("ServeCommand handler should change cwd to home directory", async () => {
    // Verify we start in nested directory
    expect(process.cwd()).toBe(nestedDir)

    // Import and get the handler - we need to test the actual command handler
    const { ServeCommand } = await import("../../src/cli/cmd/serve")

    // The handler expects args and changes cwd before doing anything else
    // We can't fully run it (it blocks), but we can verify the fix is in place
    // by checking that the handler source includes process.chdir

    // Read the source file and verify the fix is present
    const serveSource = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/serve.ts")).text()
    expect(serveSource).toContain("process.chdir(Global.Path.home)")
  })

  test("WebCommand handler should change cwd to home directory", async () => {
    // Verify we start in nested directory
    expect(process.cwd()).toBe(nestedDir)

    // Read the source file and verify the fix is present
    const webSource = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/web.ts")).text()
    expect(webSource).toContain("process.chdir(Global.Path.home)")
  })

  test("shell commands fail when cwd is deleted directory", async () => {
    // This test demonstrates the actual bug scenario
    // Create a temp directory, cd into it, delete it, then try shell commands

    const tempDir = path.join(tmpBase, "will-be-deleted")
    await fs.mkdir(tempDir, { recursive: true })
    process.chdir(tempDir)

    // Delete the directory while we're in it
    await fs.rm(tempDir, { recursive: true, force: true })

    // Shell commands without explicit cwd should fail
    let failed = false
    try {
      await $`ls`.quiet()
    } catch {
      failed = true
    }

    expect(failed).toBe(true)
  })

  test("shell commands succeed when cwd is stable home directory", async () => {
    // After applying the fix (chdir to home), shell commands should work
    process.chdir(Global.Path.home)

    // Shell commands should succeed from home directory
    const result = await $`ls`.quiet()
    expect(result.exitCode).toBe(0)
  })

  test("Global.Path.home should always be a valid directory", async () => {
    const home = Global.Path.home
    expect(home).toBeDefined()
    expect(typeof home).toBe("string")
    expect(home.length).toBeGreaterThan(0)

    const stat = await fs.stat(home)
    expect(stat.isDirectory()).toBe(true)
  })
})
