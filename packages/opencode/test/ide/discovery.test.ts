/**
 * Tests for IDE MCP server discovery via lock files.
 *
 * Exercises `Ide.discover()` and `Ide.isProcessRunning()` using temporary
 * lock files and the current process PID. No real VS Code or MCP server is
 * involved — the tests validate the lock file parsing, stale-pid cleanup,
 * and error handling paths.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import fs from "fs"
import path from "path"
import os from "os"
import { Ide } from "../../src/ide"

describe("Ide.discover", () => {
  let tmpDir: string
  const original = { ...process.env }

  beforeEach(() => {
    // Create a fresh temp directory for each test so lock files don't bleed over
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-ide-discovery-"))
  })

  afterEach(() => {
    // Restore env vars so tests don't interfere with each other
    Object.keys(process.env).forEach((key) => {
      delete process.env[key]
    })
    Object.assign(process.env, original)

    // Clean up the temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("returns null when OPENCODE_MCP_PORT is not set", async () => {
    delete process.env["OPENCODE_MCP_PORT"]
    const result = await Ide.discover(tmpDir)
    expect(result).toBeNull()
  })

  test("returns null when lock file is missing", async () => {
    process.env["OPENCODE_MCP_PORT"] = "9876"
    const result = await Ide.discover(tmpDir)
    expect(result).toBeNull()
  })

  test("returns null and cleans up when lock file has dead pid", async () => {
    const port = 9877
    process.env["OPENCODE_MCP_PORT"] = String(port)

    // pid 999999999 should never exist in practice
    const lockFilePath = path.join(tmpDir, `${port}.lock`)
    fs.writeFileSync(
      lockFilePath,
      JSON.stringify({ pid: 999999999, workspaceFolders: ["/some/path"], authToken: "test-token" }),
    )

    const result = await Ide.discover(tmpDir)
    expect(result).toBeNull()

    // The stale lock file should be cleaned up
    expect(fs.existsSync(lockFilePath)).toBe(false)
  })

  test("returns null when OPENCODE_MCP_PORT is not a number", async () => {
    process.env["OPENCODE_MCP_PORT"] = "not-a-number"
    const result = await Ide.discover(tmpDir)
    expect(result).toBeNull()
  })

  test("returns null when lock file contains invalid JSON", async () => {
    const port = 9879
    process.env["OPENCODE_MCP_PORT"] = String(port)
    const lockFilePath = path.join(tmpDir, `${port}.lock`)
    fs.writeFileSync(lockFilePath, "{not-valid-json")
    const result = await Ide.discover(tmpDir)
    expect(result).toBeNull()
  })

  test("returns null when lock file has wrong shape", async () => {
    const port = 9880
    process.env["OPENCODE_MCP_PORT"] = String(port)
    const lockFilePath = path.join(tmpDir, `${port}.lock`)
    // pid should be a number, not a string
    fs.writeFileSync(lockFilePath, JSON.stringify({ pid: "not-a-number", authToken: 123 }))
    const result = await Ide.discover(tmpDir)
    expect(result).toBeNull()
  })

  test("returns connection info when lock file is valid", async () => {
    const port = 9878
    process.env["OPENCODE_MCP_PORT"] = String(port)

    const lockFilePath = path.join(tmpDir, `${port}.lock`)
    fs.writeFileSync(
      lockFilePath,
      JSON.stringify({
        pid: process.pid, // use the current process pid — guaranteed to be alive
        workspaceFolders: ["/workspace/myproject"],
        authToken: "my-auth-token",
      }),
    )

    const result = await Ide.discover(tmpDir)
    expect(result).not.toBeNull()
    expect(result?.port).toBe(port)
    expect(result?.authToken).toBe("my-auth-token")
    expect(result?.workspaceFolders).toEqual(["/workspace/myproject"])
  })
})
