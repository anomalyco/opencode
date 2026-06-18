import path from "node:path"
import { describe, expect, test } from "bun:test"

async function runFixture(env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../fixture/mcp-session-recovery.ts")], {
    cwd: path.join(import.meta.dir, "../.."),
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    Bun.readableStreamToText(child.stdout),
    Bun.readableStreamToText(child.stderr),
  ])

  expect(code, stderr).toBe(0)
  expect(JSON.parse(stdout)).toEqual([
    { method: "initialize", session: null },
    { method: "notifications/initialized", session: "expired" },
    { method: "ping", session: "expired" },
    { method: "initialize", session: null },
    { method: "notifications/initialized", session: "replacement" },
    { method: "ping", session: "replacement" },
  ])
}

describe("mcp session recovery", () => {
  test("reinitializes and retries once after a session-bound POST returns 404", async () => {
    await runFixture()
  })

  test("reinitializes and retries once after a session-bound POST returns a missing-session 400", async () => {
    await runFixture({
      MCP_RECOVERY_STATUS: "400",
      MCP_RECOVERY_BODY: "Bad Request: No valid session ID provided",
    })
  })
})
