import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"

describe("mcp list command", () => {
  test("waits for plugins before listing servers from a cold location", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-mcp-list-"))
    const project = path.join(import.meta.dir, "..")
    const registration = path.join(root, "state", "opencode", "service-local.json")
    const plugin = {
      id: "opencode.config.mcp",
      source: { type: "builtin" },
      features: { server: true },
      state: { status: "active" },
    }
    const mcpServers = [{ name: "echo-local", status: { status: "connected" } }]
    // A cold Location lists no plugins until activation finishes, and mcp.list answers empty while
    // opencode.config.mcp has not loaded its config entries. Emulate that window on the fake server.
    let pluginsReady = false
    let pluginCalls = 0
    const calls: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/api/info") {
          return Response.json({
            version: OPENCODE_VERSION,
            pid: process.pid,
            urls: [],
            paths: { tmp: "/tmp/opencode" },
          })
        }
        calls.push(url.pathname)
        if (url.pathname === "/api/plugin") {
          pluginCalls++
          if (pluginCalls >= 3) pluginsReady = true
          return Response.json({ location: { directory: project }, data: pluginsReady ? [plugin] : [] })
        }
        if (url.pathname === "/api/mcp") {
          return Response.json({ location: { directory: project }, data: pluginsReady ? mcpServers : [] })
        }
        return Response.json({})
      },
    })

    try {
      await fs.mkdir(path.dirname(registration), { recursive: true })
      await fs.writeFile(
        registration,
        JSON.stringify({ version: OPENCODE_VERSION, url: server.url.toString(), pid: process.pid, password: "secret" }),
      )
      const result = await cli(["mcp", "list"], project, { XDG_STATE_HOME: path.join(root, "state") })

      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
      expect(result.stdout).toContain("echo-local")
      expect(calls.indexOf("/api/mcp")).toBeGreaterThan(-1)
      expect(calls.lastIndexOf("/api/plugin")).toBeLessThan(calls.indexOf("/api/mcp"))
    } finally {
      server.stop(true)
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

async function cli(args: string[], cwd: string, env?: Record<string, string>) {
  const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd,
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
