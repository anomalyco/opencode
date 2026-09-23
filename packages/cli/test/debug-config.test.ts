import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"
import { redactConfig } from "../src/commands/handlers/debug/redact"

describe("debug config command", () => {
  test("is included in troubleshooting help", async () => {
    const [debug, config] = await Promise.all([cli(["debug", "--help"]), cli(["debug", "config", "--help"])])

    expect(debug.exitCode).toBe(0)
    expect(debug.stdout).toContain("config")
    expect(debug.stdout).toContain("List configuration sources")
    expect(config.exitCode).toBe(0)
    expect(config.stdout).toContain("opencode debug config [flags]")
    expect(config.stdout).toContain("List configuration sources")
    expect(config.stdout).toContain("--reveal-secrets")
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
          providers: {
            example: {
              settings: { apiKey: "sk-example", timeout: 1200 },
              headers: { Authorization: "Bearer example", "X-API-Key": "key", "X-Custom": "opaque" },
              models: { demo: { request: { headers: { "x-auth-token": "model-secret" } } } },
            },
          },
          mcp: { remote: { oauth: { client_secret: "oauth-secret", client_id: "public" } } },
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
        if (url.pathname === "/api/info") {
          healthProbes += 1
          return Response.json({
            version: OPENCODE_VERSION,
            pid: process.pid,
            urls: [],
            paths: { tmp: "/tmp/opencode" },
          })
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
      expect(JSON.parse(result.stdout)).toEqual(redactConfig(entries))
      expect(JSON.parse(result.stdout)[0].info.providers.example).toEqual({
        settings: { apiKey: "***", timeout: 1200 },
        headers: { Authorization: "***", "X-API-Key": "***", "X-Custom": "***" },
        models: { demo: { request: { headers: { "x-auth-token": "***" } } } },
      })
      expect(JSON.parse(result.stdout)[0].info.mcp.remote.oauth).toEqual({
        client_secret: "***",
        client_id: "public",
      })
      expect(result.stdout).not.toContain("sk-example")
      expect(result.stdout).not.toContain("Bearer example")
      expect(requested?.pathname).toBe("/api/config")
      expect(requested?.searchParams.get("location[directory]")).toBe(project)
      expect(authorization).toEqual([`Basic ${btoa("opencode:secret")}`])
      expect(healthProbes).toBe(1)

      const revealed = await cli(["debug", "config", "--reveal-secrets"], project, {
        XDG_STATE_HOME: path.join(root, "state"),
      })
      expect(revealed.exitCode).toBe(0)
      expect(JSON.parse(revealed.stdout)).toEqual(entries)
      expect(authorization).toEqual([`Basic ${btoa("opencode:secret")}`, `Basic ${btoa("opencode:secret")}`])
    } finally {
      server.stop(true)
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

test("redacts URL credentials and credential environment variables without mutating config", () => {
  const input = {
    mcp: {
      local: { environment: { SERVICE_TOKEN: "token-value", PATH: "/usr/bin" } },
      remote: { url: "https://user:pass@example.com/mcp", headers: { "x-custom": "opaque" } },
    },
    url: "https://example.com/api?api_key=secret&mode=debug",
    max_tokens: 100,
  }
  expect(redactConfig(input)).toEqual({
    mcp: {
      local: { environment: { SERVICE_TOKEN: "***", PATH: "/usr/bin" } },
      remote: { url: "***", headers: { "x-custom": "***" } },
    },
    url: "***",
    max_tokens: 100,
  })
  expect(input.mcp.remote.url).toBe("https://user:pass@example.com/mcp")
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
