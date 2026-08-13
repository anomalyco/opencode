import { afterEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()))
})

async function cli(args: string[], env?: Record<string, string>) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd: path.join(import.meta.dir, ".."),
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

test("registers the console logout command", async () => {
  const result = await cli(["console", "--help"])

  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain("logout    Log out of OpenCode Console")
})

test("removes stored OpenCode Console credentials", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-console-logout-"))
  const removed: string[] = []
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/health") {
        return Response.json({ healthy: true, version: OPENCODE_VERSION, pid: process.pid })
      }
      if (request.method === "GET" && url.pathname === "/api/integration/opencode") {
        return Response.json({
          location: { directory: process.cwd(), project: { id: "global", directory: "/" } },
          data: {
            id: "opencode",
            name: "OpenCode",
            methods: [],
            connections: removed.length === 0 ? [{ type: "credential", id: "cred_test", label: "default" }] : [],
          },
        })
      }
      if (request.method === "DELETE" && url.pathname === "/api/credential/cred_test") {
        removed.push(url.pathname)
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 404 })
    },
  })
  cleanup.push(async () => {
    server.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  })
  await fs.mkdir(path.join(root, "state", "opencode"), { recursive: true })
  await fs.writeFile(
    path.join(root, "state", "opencode", "service-local.json"),
    JSON.stringify({ version: OPENCODE_VERSION, url: server.url.toString(), pid: process.pid }),
  )
  const env = {
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
  }

  const result = await cli(["console", "logout"], env)

  expect(result).toMatchObject({ exitCode: 0, stdout: "Logged out from OpenCode Console\n" })
  expect(removed).toEqual(["/api/credential/cred_test"])

  const repeated = await cli(["console", "logout"], env)
  expect(repeated).toMatchObject({ exitCode: 0, stdout: "Not logged in\n" })
})
