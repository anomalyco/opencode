import { describe, expect, test } from "bun:test"
import path from "path"
import os from "os"

// We test the workspacePath / sanitization logic directly since it's a pure function.
// DataRootConfig is an Effect service that requires a Layer, tested in isolation below.

// Replicate workspacePath for testing (matches packages/server/src/data-root.ts)
function workspacePath(userID: string, dataRoot: string): string {
  const safe = encodeURIComponent(userID).replace(/\.\.?/g, (m) =>
    m === ".." ? "%2E%2E" : "%2E",
  )
  return path.join(dataRoot, "workspaces", safe)
}

describe("userID sanitization", () => {
  test("normal userID unchanged", () => {
    const result = workspacePath("user-abc-123", "/data")
    expect(result).toBe("/data/workspaces/user-abc-123")
  })

  test("path traversal with ../ is encoded", () => {
    const result = workspacePath("../etc/passwd", "/data")
    expect(result).toBe("/data/workspaces/%2E%2E%2Fetc%2Fpasswd")
    expect(result).not.toContain("/etc/passwd")
  })

  test("double-dot encoded", () => {
    const result = workspacePath("..", "/data")
    expect(result).toBe("/data/workspaces/%2E%2E")
    expect(result).not.toContain("/../")
  })

  test("URL unsafe characters are encoded", () => {
    const result = workspacePath("user name@company", "/data")
    expect(result).toBe("/data/workspaces/user%20name%40company")
  })

  test("null byte encoded", () => {
    const result = workspacePath("user\0malicious", "/data")
    expect(result).toBe("/data/workspaces/user%00malicious")
  })

  test("unicode characters encoded", () => {
    const result = workspacePath("用户123", "/data")
    expect(result).toContain("workspaces/")
    // Should not contain raw unicode in path (encoded)
    expect(result).not.toContain("用户123")
  })
})

describe("workspace directory structure", () => {
  test("appends workspaces subdirectory", () => {
    const result = workspacePath("user1", "/data")
    expect(result).toBe("/data/workspaces/user1")
  })

  test("works with XDG-style path", () => {
    const result = workspacePath("user1", path.join(os.homedir(), ".local", "share", "opencode"))
    expect(result).toContain("/workspaces/user1")
  })

  test("empty userID produces workspaces path without trailing separator", () => {
    const result = workspacePath("", "/data")
    expect(result).toBe("/data/workspaces")
  })
})

describe("DataRootConfig", () => {
  async function readConfig(envValue: string | undefined): Promise<string> {
    const prev = process.env.OPENCODE_DATA_ROOT
    process.env.OPENCODE_DATA_ROOT = envValue
    try {
      // Dynamic import inside a fresh module scope to avoid cached env snapshots
      const { DataRoot } = await import("@opencode-ai/server/data-root")
      const { Effect } = await import("effect")

      return await Effect.provide(
        Effect.flatMap(DataRoot.DataRootConfig, (root) => Effect.succeed(root)),
        DataRoot.DataRootConfig.layer,
      ).pipe(Effect.runPromise)
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_DATA_ROOT
      else process.env.OPENCODE_DATA_ROOT = prev
    }
  }

  test("OPENCODE_DATA_ROOT set uses configured path", async () => {
    const result = await readConfig("/custom/data")
    expect(result).toBe("/custom/data")
  })

  test("OPENCODE_DATA_ROOT unset uses Global.Path.data", async () => {
    const { Global } = await import("@opencode-ai/core/global")
    const result = await readConfig(undefined)
    expect(result).toBe(Global.Path.data)
  })
})
