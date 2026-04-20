#!/usr/bin/env bun
import { execSync, spawn, spawnSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { delimiter, resolve } from "node:path"

const root = import.meta.dir
const envPath = resolve(root, ".env.development")
const state = resolve(root, ".local-dev")
const raw = process.argv.slice(2)
const idx = raw.indexOf("--service")
const name = raw[idx + 1]
const rest = raw.filter((_, i) => i !== idx && i !== idx + 1 && raw[i] !== "--conditions=browser")

const file = await Bun.file(envPath).text().catch(() => "")
file.split(/\r?\n/).forEach((line) => {
  const text = line.trim()
  if (!text || text.startsWith("#")) return
  const idx = text.indexOf("=")
  if (idx === -1) return
  const key = text.slice(0, idx).trim()
  const value = text.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "")
  if (!(key in process.env)) process.env[key] = value
})

if (idx === -1 || !name) {
  console.error("Usage: bun local-dev.ts --service <backend|frontend|relay|executor>")
  process.exit(1)
}

mkdirSync(state, { recursive: true })

function env(name: string) {
  const value = process.env[name]?.trim()
  if (value) return value
  console.error(`Missing required env var: ${name}`)
  process.exit(1)
}

function num(name: string) {
  const value = Number(env(name))
  if (!Number.isFinite(value)) {
    console.error(`Invalid numeric env var: ${name}`)
    process.exit(1)
  }
  return value
}

function kill(pid: number) {
  try {
    process.kill(pid, "SIGKILL")
  } catch {}
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function pids(port: number) {
  try {
    return execSync(`lsof -ti:${port}`, { stdio: "pipe" })
      .toString()
      .trim()
      .split("\n")
      .map((item) => Number(item))
      .filter(Boolean)
  } catch {
    return []
  }
}

function clear(port: number, file?: string) {
  pids(port).forEach(kill)
  if (!file || !existsSync(file)) return
  const pid = Number(readFileSync(file, "utf8").trim())
  if (pid) kill(pid)
  try {
    unlinkSync(file)
  } catch {}
}

function ensureInfra() {
  console.log("Starting infrastructure (Postgres)...")
  const run = spawnSync("docker", ["compose", "-f", "docker/infra-deps-local-debugging.yml", "up", "-d"], {
    cwd: root,
    stdio: "inherit",
  })
  if (run.status !== 0) {
    console.error("Failed to start infrastructure. Is Docker running?")
    process.exit(1)
  }
  console.log("Infrastructure started successfully")
}

function argv(entry: string, args: string[]) {
  process.argv = [process.argv[0] ?? "bun", entry, ...args]
}

async function boot(entry: string, args: string[], extra?: Record<string, string>) {
  if (extra) Object.assign(process.env, extra)
  argv(entry, args)
  if (entry.endsWith("/packages/opencode/src/index.ts")) {
    await import(resolve(root, "node_modules/.bun/node_modules/@opentui/solid/scripts/preload.ts"))
  }
  await import(entry)
}

function startFrontend() {
  const port = num("DEV_FRONTEND_PORT")
  const pid = resolve(state, "frontend.pid")
  const log = resolve(state, "frontend.log")
  const app = resolve(root, "packages/app")
  const out = openSync(log, "a")
  const backHost = env("DEV_BACKEND_HOST")
  const backPort = env("DEV_BACKEND_PORT")

  clear(port, pid)

  const child = spawn("bun", ["run", resolve(app, "script/dev.ts"), ...rest], {
    cwd: app,
    detached: true,
    stdio: ["ignore", out, out],
    env: {
      ...process.env,
      DEV_FRONTEND_HOST: env("DEV_FRONTEND_HOST"),
      DEV_FRONTEND_PORT: String(port),
      VITE_OPENCODE_SERVER_HOST: backHost,
      VITE_OPENCODE_SERVER_PORT: backPort,
      VITE_OPENCODE_SERVER_URL: process.env.VITE_OPENCODE_SERVER_URL?.trim() || `http://${backHost}:${backPort}`,
    },
  })

  closeSync(out)
  child.unref()
  writeFileSync(pid, `${child.pid}\n`)
  console.log(`Frontend started in background on http://${env("DEV_FRONTEND_HOST")}:${port}`)
  console.log(`PID: ${child.pid}`)
  console.log(`Log: ${log}`)
}

const svc = {
  backend: async () => {
    const host = env("DEV_BACKEND_HOST")
    const port = env("DEV_BACKEND_PORT")
    clear(Number(port))
    await boot(resolve(root, "packages/opencode/src/index.ts"), ["serve", "--hostname", host, "--port", port, ...rest], {
      DATABASE_URL: env("DATABASE_URL"),
      PUBLIC_BASE_URL: `http://${env("DEV_FRONTEND_HOST")}:${env("DEV_FRONTEND_PORT")}`,
      WORKOS_REDIRECT_URI: `http://${host}:${port}/auth/callback`,
      VERITLY_EXECUTOR_URL: env("VERITLY_EXECUTOR_URL"),
      UNIVER_SDK_WS: env("UNIVER_SDK_WS"),
      VITE_UNIVER_SDK_WS: env("VITE_UNIVER_SDK_WS"),
    })
  },
  frontend: async () => {
    startFrontend()
  },
  relay: async () => {
    const port = String(num("UNIVER_SDK_PORT"))
    clear(Number(port))
    await boot(resolve(root, "packages/relay/server.ts"), [], {
      PORT: port,
    })
  },
  executor: async () => {
    const port = new URL(env("VERITLY_EXECUTOR_URL")).port || "80"
    const python = resolve(root, "packages/univer-sdk/python")
    const user = execSync("python3 -c 'import site; print(site.getusersitepackages())'", {
      cwd: root,
      stdio: "pipe",
    })
      .toString()
      .trim()
    const path = [python, user, process.env.PYTHONPATH?.trim()].filter(Boolean).join(delimiter)
    clear(Number(port))
    await boot(resolve(root, "packages/executor/src/server.ts"), [], {
      PORT: port,
      PYTHONPATH: path,
    })
  },
} as const

if (!(name in svc)) {
  console.error(`Unknown service "${name}". Choose: ${Object.keys(svc).join(", ")}`)
  process.exit(1)
}

ensureInfra()
await svc[name as keyof typeof svc]()

if (name === "frontend") {
  const pid = resolve(state, "frontend.pid")
  const value = Number(readFileSync(pid, "utf8").trim())
  if (!alive(value)) {
    console.error("Frontend exited immediately. Check the log for details.")
    process.exit(1)
  }
}
