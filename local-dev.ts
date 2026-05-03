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
  console.error("Usage: bun local-dev.ts --service <backend|frontend|relay|executor|all>")
  process.exit(1)
}

const skipInfra = process.env["VERITLY_DEV_SKIP_INFRA"] === "1"
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

function ensureUniverSdkInstalled(python: string) {
  const found = spawnSync("python3", ["-m", "pip", "show", "veritly_univer_sdk"], {
    cwd: root,
    stdio: "ignore",
  })
  if (found.status === 0) return

  const installed = spawnSync("python3", ["-m", "pip", "install", "-e", python], {
    cwd: root,
    stdio: "inherit",
  })
  if (installed.status === 0) return

  console.error("Failed to install packages/univer-sdk/python for the local executor.")
  process.exit(installed.status ?? 1)
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
    await boot(resolve(root, "packages/opencode/src/server/main.ts"), ["--hostname", host, "--port", port, ...rest], {
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
    process.env["VERITLY_EXECUTOR_URL"] =
    process.env["VERITLY_EXECUTOR_URL"]?.trim() || "http://127.0.0.1:7777"
    const port = new URL(env("VERITLY_EXECUTOR_URL")).port || "7777"
    const python = resolve(root, "packages/univer-sdk/python")
    ensureUniverSdkInstalled(python)
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
      EXECUTOR_RUNTIME: process.env.EXECUTOR_RUNTIME?.trim() || "dangerous-local",
      PYTHONPATH: path,
    })
  },
} as const

if (name === "all") {
  if (skipInfra) {
    console.error("use --service all from the top-level dev:all only (children have VERITLY_DEV_SKIP_INFRA=1).")
    process.exit(1)
  }
  ensureInfra()
  const self = import.meta.path
  const bun = process.execPath
  const order = ["backend", "relay", "executor", "frontend"] as const
  console.log("[dev:all] Starting backend, relay, executor, and frontend (Postgres: docker/infra-deps-local-debugging.yml).")
  const childRest = rest.filter((a) => a !== "all")
  const children: ReturnType<typeof spawn>[] = []
  for (const s of order) {
    const child = spawn(
      bun,
      [self, "--service", s, ...childRest],
      {
        cwd: root,
        env: { ...process.env, VERITLY_DEV_SKIP_INFRA: "1" },
        stdio: "inherit",
      },
    )
    children.push(child)
  }
  let stopping = false
  const stopAllFromFailure = (source: string, code: number | null) => {
    if (stopping) return
    if (code === 0) return
    stopping = true
    console.error(`[dev:all] child "${source}" exited with ${code}; stopping other services.`)
    for (const c of children) {
      try {
        c.kill("SIGTERM")
      } catch {
        /* ignore */
      }
    }
    process.exit(typeof code === "number" && code > 0 ? code : 1)
  }
  for (let i = 0; i < order.length; i++) {
    const s = order[i]!
    const c = children[i]!
    c.on("error", (err) => {
      console.error(`[dev:all] child "${s}" error:`, err)
      stopAllFromFailure(s, 1)
    })
    c.on("exit", (code, signal) => {
      if (stopping) return
      if (signal) {
        if (signal === "SIGINT" || signal === "SIGTERM") return
        stopAllFromFailure(s, 1)
        return
      }
      if (code != null) {
        stopAllFromFailure(s, code)
      }
    })
  }
  const sig = () => {
    if (stopping) return
    stopping = true
    for (const c of children) {
      try {
        c.kill("SIGINT")
      } catch {
        /* ignore */
      }
    }
    process.exit(130)
  }
  process.on("SIGINT", sig)
  process.on("SIGTERM", sig)
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  await new Promise<void>(() => {})
}

if (!(name in svc)) {
  console.error(`Unknown service "${name}". Choose: ${Object.keys(svc).join(", ")}, or all`)
  process.exit(1)
}

if (!skipInfra) {
  ensureInfra()
}
await svc[name as keyof typeof svc]()

if (name === "frontend") {
  const pid = resolve(state, "frontend.pid")
  const value = Number(readFileSync(pid, "utf8").trim())
  if (!alive(value)) {
    console.error("Frontend exited immediately. Check the log for details.")
    process.exit(1)
  }
}
