import { describe, expect, test } from "bun:test"
import { OPENCODE_VERSION } from "../src/version"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// Every command that talks to a server must expose the same server selection as `run` and
// `session`, so they can be pointed at an explicit server or a private one instead of silently
// starting the background service.
const commands = [
  ["mcp", "list"],
  ["mcp", "auth"],
  ["mcp", "logout"],
  ["plugin", "list"],
  ["plugin", "check"],
  ["plugin", "update"],
  ["debug", "agents"],
  ["debug", "config"],
]

describe("commands that resolve a server", () => {
  test("advertises --standalone and --server in help", async () => {
    const results = await Promise.all(commands.map((command) => cli([...command, "--help"])))
    for (const [index, result] of results.entries()) {
      const label = `opencode ${commands[index].join(" ")} --help`
      expect({ label, exitCode: result.exitCode, stderr: result.stderr }).toEqual({
        label,
        exitCode: 0,
        stderr: "",
      })
      expect({ label, standalone: result.stdout.includes("--standalone") }).toEqual({ label, standalone: true })
      expect({ label, server: result.stdout.includes("--server") }).toEqual({ label, server: true })
    }
  })

  test("connects to an explicit --server instead of the background service", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cli-server-params-"))
    const requested: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/api/info")
          return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [] })
        requested.push(url.pathname)
        return Response.json({ data: [] })
      },
    })

    try {
      const result = await cli(["mcp", "list", "--server", server.url.toString()], path.join(import.meta.dir, ".."), {
        XDG_CACHE_HOME: path.join(root, "cache"),
        XDG_CONFIG_HOME: path.join(root, "config"),
        XDG_DATA_HOME: path.join(root, "data"),
        XDG_STATE_HOME: path.join(root, "state"),
      })

      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
      expect(result.stdout).toContain("No MCP servers configured")
      expect(requested).toEqual(["/api/mcp"])
      expect(await fileNames(root)).not.toContain("service-local.json")
    } finally {
      server.stop(true)
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

async function fileNames(root: string) {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
}

async function cli(args: string[], cwd = path.join(import.meta.dir, ".."), env?: Record<string, string>) {
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
