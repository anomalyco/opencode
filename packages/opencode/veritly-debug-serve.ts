import os from "node:os"
import path from "node:path"
import { config } from "dotenv"

const packageRoot = path.resolve(import.meta.dir)
const opencodeRoot = path.resolve(packageRoot, "..", "..")
const repoRoot = path.resolve(packageRoot, "..", "..", "..", "..")
const envPath = path.join(opencodeRoot, ".env.development")

function log(message: string) {
  console.log(`[veritly-debug-serve] ${message}`)
}

config({ path: envPath, override: false })

const frontHost = process.env.DEV_FRONTEND_HOST?.trim() || "127.0.0.1"
const frontPort = process.env.DEV_FRONTEND_PORT?.trim() || "4444"
const host = process.env.DEV_BACKEND_HOST?.trim() || "127.0.0.1"
const port = process.env.DEV_BACKEND_PORT?.trim() || "4096"

if (!process.env.PUBLIC_BASE_URL?.trim()) {
  process.env.PUBLIC_BASE_URL = `http://${frontHost}:${frontPort}`
}

if (!process.env.WORKOS_REDIRECT_URI?.trim()) {
  process.env.WORKOS_REDIRECT_URI = `http://${host}:${port}/auth/callback`
}

if (!process.env.VERITLY_EXECUTOR_URL?.trim()) {
  process.env.VERITLY_EXECUTOR_URL = "http://localhost:7777"
}

process.env.OPENCODE_PROJECTS_ROOT = path.join(repoRoot, ".veritly", "projects")

log(`root=${opencodeRoot}`)
log(`opencode_projects_root=${process.env.OPENCODE_PROJECTS_ROOT}`)

const relayPort = process.env.UNIVER_SDK_PORT?.trim() ? Number(process.env.UNIVER_SDK_PORT.trim()) : 18766
const relayHealthUrl = `http://127.0.0.1:${relayPort}/health`

async function relayHealthy(): Promise<boolean> {
  try {
    const r = await fetch(relayHealthUrl, { signal: AbortSignal.timeout(400) })
    return r.ok
  } catch {
    return false
  }
}

let ownedRelay: ReturnType<typeof Bun.spawn> | null = null

function stopOwnedRelay() {
  if (!ownedRelay) return
  try {
    ownedRelay.kill("SIGTERM")
  } catch {
    /* ignore */
  }
  ownedRelay = null
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, stopOwnedRelay)
}
process.on("exit", stopOwnedRelay)

if (!(await relayHealthy())) {
  log(`univer-sdk-relay: not healthy at ${relayHealthUrl}`)
}

process.argv = [
  process.argv[0] ?? "bun",
  path.join(packageRoot, "src", "server", "main.ts"),
  "--port",
  port,
  "--hostname",
  host,
]

await import("./src/server/main.ts")
