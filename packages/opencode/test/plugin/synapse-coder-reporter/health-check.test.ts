import { test, expect, describe, afterEach } from "bun:test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { resolve as pathResolve } from "node:path"

const scriptPath = pathResolve(import.meta.dir, "..", "..", "..", "..", "..", ".opencode", "scripts", "health-check.ts")

function startSidecar(env: Record<string, string>): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [scriptPath], {
    env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
  })
}

function waitForPort(proc: ChildProcessWithoutNullStreams, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sidecar did not announce port in time")), timeoutMs)
    proc.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("listening on http://")) {
        clearTimeout(timer)
        resolve()
      }
    })
    proc.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc.on("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`sidecar exited early with code ${code}`))
    })
  })
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url)
  const body = await res.json()
  return { status: res.status, body }
}

describe("opencode health sidecar", () => {
  let proc: ChildProcessWithoutNullStreams | null = null

  afterEach(() => {
    if (proc && !proc.killed) proc.kill("SIGTERM")
    proc = null
  })

  test("GET /health returns ok with timestamp and uptime", async () => {
    proc = startSidecar({ HEALTH_CHECK_PORT: "4141" })
    await waitForPort(proc)
    const { status, body } = await fetchJson("http://127.0.0.1:4141/health")
    expect(status).toBe(200)
    expect(body).toEqual({
      status: "ok",
      timestamp: expect.any(String),
      uptime: expect.any(Number),
    })
    const payload = body as { timestamp: string; uptime: number }
    expect(() => new Date(payload.timestamp).toISOString()).not.toThrow()
    expect(payload.uptime).toBeGreaterThanOrEqual(0)
  })

  test("GET /version returns version, buildSha, buildDate, node, bun", async () => {
    proc = startSidecar({
      HEALTH_CHECK_PORT: "4142",
      BUILD_SHA: "abc1234",
      BUILD_DATE: "2026-07-18",
    })
    await waitForPort(proc)
    const { status, body } = await fetchJson("http://127.0.0.1:4142/version")
    expect(status).toBe(200)
    expect(body).toEqual({
      version: expect.any(String),
      buildSha: "abc1234",
      buildDate: "2026-07-18",
      node: expect.any(String),
      bun: expect.any(String),
    })
    const payload = body as { version: string }
    expect(payload.version).not.toBe("unknown")
  })

  test("GET / returns endpoint listing", async () => {
    proc = startSidecar({ HEALTH_CHECK_PORT: "4143" })
    await waitForPort(proc)
    const { status, body } = await fetchJson("http://127.0.0.1:4143/")
    expect(status).toBe(200)
    expect(body).toEqual({
      service: "opencode-health-sidecar",
      endpoints: ["/health", "/version"],
    })
  })

  test("unknown path returns 404", async () => {
    proc = startSidecar({ HEALTH_CHECK_PORT: "4144" })
    await waitForPort(proc)
    const { status, body } = await fetchJson("http://127.0.0.1:4144/nope")
    expect(status).toBe(404)
    expect(body).toEqual({ error: "Not Found", path: "/nope" })
  })

  test("POST /health returns 405", async () => {
    proc = startSidecar({ HEALTH_CHECK_PORT: "4145" })
    await waitForPort(proc)
    const res = await fetch("http://127.0.0.1:4145/health", { method: "POST" })
    expect(res.status).toBe(405)
    const body = await res.json()
    expect(body).toEqual({ error: "Method Not Allowed" })
  })
})
