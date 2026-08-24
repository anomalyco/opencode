import path from "node:path"
import { describe, expect, test } from "bun:test"

describe("mcp session recovery", () => {
  // fork(mcp-dual-era-client A3): the 2026-07-28 spec removes the
  // Mcp-Session-Id header and the whole session concept this test exercises
  // (SEP-2567 — protocol-level sessions are gone; servers needing cross-call
  // state now use explicit, server-minted handles passed as tool arguments).
  // @modelcontextprotocol/client v2's real behavior confirms this: a 404 on
  // a session-bound POST now throws SdkHttpError(CLIENT_HTTP_NOT_IMPLEMENTED)
  // instead of reinitializing — there is no session to recover. This isn't a
  // migration bug, the feature itself no longer exists. Skipped rather than
  // deleted so the historical behavior stays documented.
  test.skip("reinitializes and retries once after a session-bound POST returns 404", async () => {
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
})
