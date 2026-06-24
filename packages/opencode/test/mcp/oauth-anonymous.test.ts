import path from "node:path"
import { expect, test } from "bun:test"

test("explicit auth fails when anonymous initialize and catalog emit no OAuth challenge", async () => {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../fixture/mcp-oauth-anonymous.ts")], {
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
  const marker = "MCP_OAUTH_RESULT="
  expect(stdout).toContain(marker)
  expect(JSON.parse(stdout.slice(stdout.lastIndexOf(marker) + marker.length))).toEqual({
    initialStatus: "connected",
    initialTools: ["anonymous-oauth_protected"],
    protectedToolFailed: true,
    authStatus: "failed",
    authError:
      "The server did not issue a standard OAuth challenge. Anonymous MCP access remains available, but authentication was not completed. Verify the server's OAuth configuration or use credentials supported by the server.",
    hasStoredTokens: false,
    finalStatus: "connected",
    finalTools: ["anonymous-oauth_protected"],
  })
}, 30_000)
