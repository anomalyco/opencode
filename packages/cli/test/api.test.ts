import path from "node:path"
import { expect, test } from "bun:test"
import { OPENCODE_VERSION } from "../src/version"

test.each([
  { status: 500, body: null, exitCode: 1 },
  { status: 500, body: "Internal server error", exitCode: 1 },
  { status: 404, body: JSON.stringify({ _tag: "SessionNotFoundError" }), exitCode: 1 },
  { status: 204, body: null, exitCode: 0 },
  { status: 200, body: JSON.stringify({ data: [] }), exitCode: 0 },
])("api reports HTTP $status with body $body", async ({ status, body, exitCode }) => {
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/api/health")
        return Response.json({ healthy: true, version: OPENCODE_VERSION, pid: process.pid })
      return new Response(body, { status })
    },
  })
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "src/index.ts",
      "api",
      "--server",
      server.url.toString(),
      "delete",
      "/api/session/ses_test",
    ],
    { cwd: path.join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(code).toBe(exitCode)
  expect(stdout.trim()).toBe(body ?? "")
  if (exitCode) expect(stderr).toContain(`HTTP ${status}`)
})
