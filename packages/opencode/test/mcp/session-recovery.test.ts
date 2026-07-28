import path from "node:path"
import { describe, expect, test } from "bun:test"

describe("mcp session recovery", () => {
  test("reinitializes and retries once after a session-bound POST returns 404", async () => {
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../fixture/mcp-session-recovery.ts")], {
      cwd: path.join(import.meta.dir, "../.."),
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
  })

  test("retries a concurrent stale response after recovery completes", async () => {
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../fixture/mcp-session-recovery.ts")], {
      cwd: path.join(import.meta.dir, "../.."),
      env: { ...process.env, MCP_RECOVERY_CONCURRENT: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      Bun.readableStreamToText(child.stdout),
      Bun.readableStreamToText(child.stderr),
    ])

    expect(code, stderr).toBe(0)
    const posts = JSON.parse(stdout) as Array<{ method: string; session: string | null }>
    expect(posts.filter((post) => post.method === "initialize").map((post) => post.session)).toEqual([null, null])
    expect(posts.filter((post) => post.method === "ping" && post.session === "expired")).toHaveLength(2)
    expect(posts.filter((post) => post.method === "ping" && post.session === "replacement")).toHaveLength(2)
  })
})
