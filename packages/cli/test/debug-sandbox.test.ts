import { expect, test } from "bun:test"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

test("debug sandbox uses the connected server policy despite conflicting client configuration", async () => {
  await using root = await tmpdir()
  await Bun.write(path.join(root.path, "config", "opencode.json"), JSON.stringify({ experimental: { sandbox: { enabled: true } } }))
  const requests: string[] = []
  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/info") return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [] })
      requests.push(url.pathname)
      expect(request.headers.get("authorization")).toBe(`Basic ${btoa("opencode:secret")}`)
      return Response.json({
        active: false,
        reads: "unrestricted",
        escalation: "disabled",
        writableRoots: [],
        readableRoots: [],
      })
    },
  })
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", "debug", "sandbox", "--server", server.url.href], {
    cwd: path.join(import.meta.dir, ".."),
    env: isolatedEnv(root.path, { OPENCODE_PASSWORD: "secret" }),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(JSON.parse(stdout)).toMatchObject({ active: false })
  expect(requests).toEqual(["/api/experimental/sandbox/status"])
})
