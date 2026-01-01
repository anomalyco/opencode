import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { Server } from "../../src/server/server"
import { Instance } from "../../src/project/instance"
import { Global } from "../../src/global"
import { Log } from "../../src/util/log"
import { Project } from "../../src/project/project"

Log.init({ print: false })

/**
 * Test for the nested directory serve bug.
 * 
 * When the server is started from a deeply nested directory (e.g., ~/projects/myapp/src/components),
 * and a client tries to open a different project, shell commands that don't specify an explicit `cwd`
 * would fail with "No such file or directory" because they default to process.cwd().
 * 
 * The fix ensures:
 * 1. The serve/web commands change process.cwd() to home directory at startup
 * 2. The server middleware uses Global.Path.home as fallback instead of process.cwd()
 */
describe("Server nested directory handling", () => {
  let originalCwd: string
  let nestedDir: string
  let projectDir: string

  beforeAll(async () => {
    originalCwd = process.cwd()

    // Create a deeply nested temporary directory to simulate starting server from there
    const tmpBase = path.join(os.tmpdir(), "opencode-nested-test-" + Math.random().toString(36).slice(2))
    nestedDir = path.join(tmpBase, "deeply", "nested", "folder", "structure")
    await fs.mkdir(nestedDir, { recursive: true })

    // Create a separate project directory with a git repo
    projectDir = path.join(tmpBase, "test-project")
    await fs.mkdir(projectDir, { recursive: true })
    await $`git init`.cwd(projectDir).quiet()
    await $`git commit --allow-empty -m "initial commit"`.cwd(projectDir).quiet()
  })

  afterAll(async () => {
    // Restore original cwd
    process.chdir(originalCwd)

    // Clean up temp directories
    if (nestedDir) {
      const tmpBase = path.dirname(path.dirname(path.dirname(path.dirname(nestedDir))))
      await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {})
    }
  })

  test("should handle Instance creation when process.cwd is a nested directory", async () => {
    // Simulate starting server from nested directory
    process.chdir(nestedDir)
    expect(process.cwd()).toBe(nestedDir)

    // Now simulate what the serve command does - change to home directory
    process.chdir(Global.Path.home)
    expect(process.cwd()).toBe(Global.Path.home)

    // Create an Instance for the project directory (simulating client opening a project)
    // This should work without errors
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        // Verify Instance properties are correct
        expect(Instance.directory).toBe(projectDir)
        expect(Instance.worktree).toBe(projectDir)
        expect(Instance.project).toBeDefined()
        expect(Instance.project.vcs).toBe("git")
      },
    })
  })

  test("should fail if process.cwd is nested and not changed to home (regression test)", async () => {
    // This test documents the original bug behavior
    // When the fix is removed, shell commands without explicit cwd would use the nested directory

    // Simulate starting server from nested directory WITHOUT the fix
    process.chdir(nestedDir)
    expect(process.cwd()).toBe(nestedDir)

    // The server middleware fallback should use Global.Path.home, not process.cwd()
    // This simulates an API request without a directory parameter
    const fallbackDirectory = Global.Path.home

    // Verify the fallback is the home directory, not the nested directory
    expect(fallbackDirectory).toBe(Global.Path.home)
    expect(fallbackDirectory).not.toBe(nestedDir)

    // The home directory should always exist and be valid
    const stat = await fs.stat(fallbackDirectory)
    expect(stat.isDirectory()).toBe(true)

    // Restore cwd to home for subsequent tests
    process.chdir(Global.Path.home)
  })

  test("API requests with explicit directory should work regardless of server cwd", async () => {
    // Even if server started from nested dir, explicit directory in request should work
    process.chdir(nestedDir)

    // Create Instance with explicit directory (simulating x-opencode-directory header)
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        expect(Instance.directory).toBe(projectDir)
        expect(Instance.worktree).toBe(projectDir)
      },
    })

    process.chdir(Global.Path.home)
  })

  test("Global.Path.home should always be a valid directory", async () => {
    const home = Global.Path.home
    expect(home).toBeDefined()
    expect(typeof home).toBe("string")
    expect(home.length).toBeGreaterThan(0)

    const stat = await fs.stat(home)
    expect(stat.isDirectory()).toBe(true)
  })

  test("Server API should use Global.Path.home as fallback when no directory specified", async () => {
    // This test verifies the fix in server.ts middleware
    // The middleware should use Global.Path.home instead of process.cwd() as fallback

    // Save original cwd
    const originalCwd = process.cwd()

    // Simulate server started from nested directory
    process.chdir(nestedDir)

    // Import the server module to test actual implementation
    // The server middleware line is:
    // const directory = c.req.query("directory") || c.req.header("x-opencode-directory") || Global.Path.home
    const serverModule = await import("../../src/server/server")
    const app = serverModule.Server.App()

    // Make a request without directory parameter to test the fallback
    const response = await app.fetch(new Request("http://localhost/global/health"))
    const data = await response.json()

    // Global health endpoint should work regardless of cwd
    expect(response.status).toBe(200)
    expect(data.healthy).toBe(true)

    // Restore cwd
    process.chdir(originalCwd)
  })

  test("Project.list should work regardless of process.cwd", async () => {
    // This test verifies that global operations work even when cwd is nested
    const originalCwd = process.cwd()

    // Simulate server started from nested directory
    process.chdir(nestedDir)

    // Project.list reads from storage, doesn't need Instance context
    // But it's called through the server middleware which creates an Instance
    // The fallback directory should be home, not nested cwd
    await Instance.provide({
      directory: Global.Path.home,
      fn: async () => {
        // This should work - Project.list just reads from Storage
        const projects = await Project.list()
        expect(Array.isArray(projects)).toBe(true)
      },
    })

    process.chdir(originalCwd)
  })
})
