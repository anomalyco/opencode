import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"

describe("debug config command", () => {
  test("is included in troubleshooting help", async () => {
    const [debug, config] = await Promise.all([cli(["debug", "--help"]), cli(["debug", "config", "--help"])])

    expect(debug.exitCode).toBe(0)
    expect(debug.stdout).toContain("config")
    expect(debug.stdout).toContain("List configuration sources")
    expect(config.exitCode).toBe(0)
    expect(config.stdout).toContain("opencode debug config [flags]")
    expect(config.stdout).toContain("List configuration sources")
  })

  test("prints config entries from the invoking directory without reordering permissions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-debug-config-"))
    const project = path.join(import.meta.dir, "..")
    const registration = path.join(root, "state", "opencode", "service-local.json")
    const entries = [
      {
        type: "document",
        path: path.join(project, "opencode.json"),
        info: {
          permissions: [
            { action: "shell", resource: "*", effect: "ask" },
            { action: "shell", resource: "git status", effect: "allow" },
          ],
        },
      },
    ]
    let requested: URL | undefined
    let healthProbes = 0
    const authorization: Array<string | null> = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/api/health") {
          healthProbes += 1
          return Response.json({ healthy: true, version: OPENCODE_VERSION, pid: process.pid })
        }
        requested = url
        authorization.push(request.headers.get("authorization"))
        return Response.json(entries)
      },
    })

    try {
      await fs.mkdir(path.dirname(registration), { recursive: true })
      await fs.writeFile(
        registration,
        JSON.stringify({ version: OPENCODE_VERSION, url: server.url.toString(), pid: process.pid, password: "secret" }),
      )
      const result = await cli(["debug", "config"], project, { XDG_STATE_HOME: path.join(root, "state") })

      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
      expect(JSON.parse(result.stdout)).toEqual(entries)
      expect(requested?.pathname).toBe("/api/config")
      expect(requested?.searchParams.get("location[directory]")).toBe(project)
      expect(authorization).toEqual([`Basic ${btoa("opencode:secret")}`])
      expect(healthProbes).toBe(1)
    } finally {
      server.stop(true)
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

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
