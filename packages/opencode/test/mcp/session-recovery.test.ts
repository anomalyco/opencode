import path from "node:path"
import { describe, expect, test } from "bun:test"

async function runFixture(mode: string) {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../fixture/mcp-session-recovery.ts"), mode], {
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
  return JSON.parse(stdout) as {
    ok: boolean
    error?: string
    posts: Array<{ method: string; session: string | null }>
  }
}

const recoveredPosts = [
  { method: "initialize", session: null },
  { method: "notifications/initialized", session: "expired" },
  { method: "ping", session: "expired" },
  { method: "initialize", session: null },
  { method: "notifications/initialized", session: "replacement" },
  { method: "ping", session: "replacement" },
]

describe("mcp session recovery", () => {
  test("reinitializes and retries once after a session-bound POST returns 404", async () => {
    const result = await runFixture("404")

    expect(result.ok).toBe(true)
    expect(result.posts).toEqual(recoveredPosts)
  })

  test("reinitializes and retries once after a POST returns a 400 missing-session error", async () => {
    for (const mode of ["400-text", "400-json"]) {
      const result = await runFixture(mode)

      expect(result.ok).toBe(true)
      expect(result.posts).toEqual(recoveredPosts)
    }
  })

  test("does not retry unrelated 400 responses", async () => {
    const result = await runFixture("400-other")

    expect(result.ok).toBe(false)
    expect(result.error).toContain("Error POSTing to endpoint")
    expect(result.posts).toEqual([
      { method: "initialize", session: null },
      { method: "notifications/initialized", session: "expired" },
      { method: "ping", session: "expired" },
    ])
  })
})
