#!/usr/bin/env bun
import { execSync, spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"

const root = import.meta.dir
const state = resolve(root, ".local-dev")
const raw = process.argv.slice(2)
const idx = raw.indexOf("--service")
const name = raw[idx + 1]
const rest = raw.filter((_, i) => i !== idx && i !== idx + 1 && raw[i] !== "--conditions=browser")

if (idx === -1 || !name) {
  console.error("Usage: bun --env-file=.env.development local-dev.ts --service <backend|frontend|relay|compat|all>")
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

function kill(pid: number) {
  try {
    process.kill(pid, "SIGKILL")
  } catch {}
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

const infraComposeFile = "docker/infra-deps-local-debugging.yml"

let memoInfraComposeArgv: string[] | undefined

function composeProbeOk(cmd: string, args: string[]) {
  return spawnSync(cmd, args, { cwd: root, stdio: "ignore" }).status === 0
}

/** `docker compose` / `podman compose` / `docker-compose` — whatever speaks to your runtime (OrbStack, Colima, Podman, …). */
function infraComposeArgv(): string[] {
  if (memoInfraComposeArgv) return memoInfraComposeArgv
  const f = infraComposeFile
  const tail = ["-f", f, "up", "-d"]
  const bin = process.env.VERITLY_DEV_COMPOSE_BIN?.trim()
  let out: string[]
  if (bin) {
    const base = basename(bin)
    if (base === "docker-compose" || base.startsWith("docker-compose")) out = [bin, ...tail]
    else out = [bin, "compose", ...tail]
  } else if (composeProbeOk("docker", ["compose", "version"])) out = ["docker", "compose", ...tail]
  else if (composeProbeOk("podman", ["compose", "version"])) out = ["podman", "compose", ...tail]
  else if (composeProbeOk("docker-compose", ["version"])) out = ["docker-compose", ...tail]
  else {
    console.error(
      "No Compose CLI found. Install a Docker-compatible engine with Compose v2 (`docker compose`), Podman (`podman compose`), or standalone `docker-compose`.",
    )
    console.error("Override: VERITLY_DEV_COMPOSE_BIN=docker | podman | /path/to/docker-compose")
    process.exit(1)
  }
  memoInfraComposeArgv = out
  return out
}

function infraComposeLabel() {
  const a = infraComposeArgv()
  return a[1] === "compose" ? `${a[0]} compose` : a[0]
}

function ensureInfra() {
  const argv = infraComposeArgv()
  const cmd = argv[0]
  if (!cmd) {
    console.error("internal: empty compose argv")
    process.exit(1)
  }
  console.log(`Starting infrastructure (Postgres + MinIO) via ${cmd}…`)
  const run = spawnSync(cmd, argv.slice(1), {
    cwd: root,
    stdio: "inherit",
  })
  if (run.status !== 0) {
    console.error("Failed to start infrastructure. Is the container engine running and reachable?")
    process.exit(1)
  }
  console.log("Infrastructure started successfully")
}

async function runDbMigrate() {
  const dbUrl = process.env.DATABASE_URL?.trim()
  if (!dbUrl) {
    console.error("Missing DATABASE_URL; cannot run db:migrate")
    process.exit(1)
  }
  if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
    return
  }
  const base = resolve(root, "packages/opencode/src/storage")
  const { Database } = await import(resolve(base, "db.pg"))
  const { runPostgresMigrations } = await import(resolve(base, "migrate-pg.ts"))
  await Database.initialize()
  await runPostgresMigrations()
  console.log("PostgreSQL migrations applied (db:migrate)")
}

function argv(entry: string, args: string[]) {
  process.argv = [process.argv[0] ?? "bun", entry, ...args]
}

async function boot(entry: string, args: string[], extra?: Record<string, string>) {
  if (extra) Object.assign(process.env, extra)
  argv(entry, args)
  await import(entry)
}

function compatListenHost() {
  const value = process.env.UNIVER_COMPAT_HOST?.trim()
  if (value) return value
  return "127.0.0.1"
}

function compatListenPort() {
  const raw = process.env.UNIVER_COMPAT_PORT?.trim()
  if (!raw) return 8787
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) {
    console.error("Invalid UNIVER_COMPAT_PORT (expected integer)")
    process.exit(1)
  }
  return n
}

/** When `VITE_UNIVER_BACKEND_URL` is unset, point Vite at local `@opencode-ai/univer-compat`. */
function defaultUniverBackendUrl() {
  const existing = process.env.VITE_UNIVER_BACKEND_URL?.trim()
  if (existing) return existing
  return `http://${compatListenHost()}:${compatListenPort()}`
}

async function startFrontend() {
  const port = num("DEV_FRONTEND_PORT")
  const app = resolve(root, "packages/app")
  const backHost = env("DEV_BACKEND_HOST")
  const backPort = env("DEV_BACKEND_PORT")
  const frontHost = env("DEV_FRONTEND_HOST")

  clear(port)

  await boot(resolve(app, "script/dev.ts"), [...rest], {
    DEV_FRONTEND_HOST: frontHost,
    DEV_FRONTEND_PORT: String(port),
    VITE_OPENCODE_SERVER_HOST: backHost,
    VITE_OPENCODE_SERVER_PORT: backPort,
    VITE_OPENCODE_SERVER_URL: process.env.VITE_OPENCODE_SERVER_URL?.trim() || `http://${backHost}:${backPort}`,
    VITE_UNIVER_BACKEND_URL: defaultUniverBackendUrl(),
  })
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
      UNIVER_SDK_WS: env("UNIVER_SDK_WS"),
      VITE_UNIVER_SDK_WS: env("VITE_UNIVER_SDK_WS"),
    })
  },
  frontend: async () => {
    await startFrontend()
  },
  relay: async () => {
    const port = String(num("UNIVER_SDK_PORT"))
    clear(Number(port))
    await boot(resolve(root, "packages/relay/server.ts"), [], {
      PORT: port,
    })
  },
  compat: async () => {
    const port = compatListenPort()
    const pid = resolve(state, "compat.pid")
    const host = compatListenHost()
    clear(port, pid)
    console.log(
      `Starting univer-compat on http://${host}:${port} (needs UNIVER_COMPAT_S3_*; local MinIO = ${infraComposeFile}; prod = S3 e.g. DigitalOcean Spaces)`,
    )
    await boot(resolve(root, "packages/univer-compat/script/serve.ts"), [], {
      PORT: String(port),
    })
    writeFileSync(pid, `${process.pid}\n`)
  },
} as const

if (name === "all") {
  if (skipInfra) {
    console.error("use --service all from the top-level dev:all only (children have VERITLY_DEV_SKIP_INFRA=1).")
    process.exit(1)
  }
  ensureInfra()
  await runDbMigrate()
  const self = import.meta.path
  const bun = process.execPath
  const order = ["backend", "relay", "compat", "frontend"] as const
  console.log(
    `[dev:all] Starting backend, relay, univer-compat (http://${compatListenHost()}:${compatListenPort()}), frontend — Postgres + MinIO: ${infraComposeFile} (${infraComposeLabel()}).`,
  )
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
  await runDbMigrate()
}
await svc[name as keyof typeof svc]()
