import { Hono } from "hono"
import { mkdir, readdir, rm, writeFile, unlink } from "fs/promises"
import { join, normalize } from "path"

const lib = process.env.MICROPYTHON_LIB?.trim() || join(import.meta.dir, "../mpy-lib")
const bin = process.env.MICROPYTHON_BIN?.trim() || "micropython"
const dataRoot = process.env.EXECUTOR_DATA_DIR?.trim() || process.env.VM_DATA_DIR?.trim() || "/tmp/veritly-executor"
const idle = Number(process.env.VM_INACTIVITY_TIMEOUT_MS ?? "300000")
const cacheMs = Number(process.env.READYZ_INTERVAL_MS ?? "60000")

type Session = {
  id: string
  dir: string
  created: number
  last: number
}

type ReadyzStatic = {
  micropythonBin: string
  micropythonRunnable: boolean
  micropythonVersion: string | null
  libPath: string
  libReadable: boolean
  probeExit: number | null
  probeOutput: string | null
}

export type ReadyzBody = {
  ok: boolean
  service: "executor"
  mode: "micropython"
  cached: boolean
  cachedAgeMs?: number
  activeSessions: number
  static: ReadyzStatic
  errors: string[]
}

const app = new Hono()
const sessions = new Map<string, Session>()

let cache: { at: number; body: ReadyzBody } | null = null
let lock: Promise<ReadyzBody> | null = null

function log(level: "info" | "error" | "warn", message: string, meta?: object) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] [${level}] ${message}`, meta ? JSON.stringify(meta) : "")
}

function cwdFor(dataRootDir: string, workdir?: string) {
  const rel = normalize(workdir ?? ".")
  const segs = rel.split(/[/\\]/).filter((s) => s && s !== ".")
  if (segs.some((s) => s === "..")) throw new Error("invalid workdir")
  return join(dataRootDir, ...segs)
}

async function probeReadyz(): Promise<ReadyzBody> {
  const err: string[] = []
  const run = Bun.spawnSync([bin, "--version"], { stdout: "pipe", stderr: "ignore" })
  const okRun = run.success
  if (!okRun) err.push("micropython_not_runnable")
  const ver = run.success ? new TextDecoder().decode(run.stdout).trim().split("\n")[0] ?? null : null

  let libOk = false
  const st = await Bun.file(join(lib, "veritly_univer_sdk.py")).stat().catch(() => null)
  libOk = Boolean(st?.isFile)
  if (!libOk) err.push("bundle_missing")

  let probeExit: number | null = null
  let probeOut: string | null = null
  if (okRun && libOk) {
    const p = Bun.spawnSync(
      [bin, "-c", "import veritly_univer_sdk; print('__readyz_ok__')"],
      {
        env: { ...process.env, MICROPYPATH: lib },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    probeExit = p.exitCode ?? -1
    const o = new TextDecoder().decode(p.stdout ?? new Uint8Array())
    const e = new TextDecoder().decode(p.stderr ?? new Uint8Array())
    probeOut = [o, e].filter(Boolean).join("\n").trim()
    if (!probeOut.includes("__readyz_ok__")) err.push("probe_failed")
  }

  const stat: ReadyzStatic = {
    micropythonBin: bin,
    micropythonRunnable: okRun,
    micropythonVersion: ver,
    libPath: lib,
    libReadable: libOk,
    probeExit,
    probeOutput: probeOut,
  }

  return {
    ok: err.length === 0,
    service: "executor",
    mode: "micropython",
    cached: false,
    activeSessions: sessions.size,
    static: stat,
    errors: err,
  }
}

async function readyzPayload(): Promise<ReadyzBody> {
  if (cacheMs > 0 && cache && Date.now() - cache.at < cacheMs)
    return { ...cache.body, cached: true, cachedAgeMs: Date.now() - cache.at }
  lock ??= probeReadyz()
    .then((b) => {
      cache = { at: Date.now(), body: { ...b, cached: false } }
      return b
    })
    .finally(() => {
      lock = null
    })
  return await lock
}

async function drop(s: Session) {
  await rm(s.dir, { recursive: true, force: true }).catch(() => undefined)
}

async function ensure(id: string) {
  let s = sessions.get(id)
  if (s) return s
  const dir = join(dataRoot, "sessions", id)
  await mkdir(dir, { recursive: true })
  s = { id, dir, created: Date.now(), last: Date.now() }
  sessions.set(id, s)
  log("info", "session created", { id })
  return s
}

async function run(s: Session, code: string, capMs: number, workdir?: string) {
  s.last = Date.now()
  const runDir = cwdFor(s.dir, workdir)
  await mkdir(runDir, { recursive: true })
  const script = join(runDir, "_exec.py")
  await writeFile(script, code, "utf8")
  const proc = Bun.spawn([bin, script], {
    cwd: runDir,
    env: { ...process.env, MICROPYPATH: lib },
    stdout: "pipe",
    stderr: "pipe",
  })
  let timed = false
  const killer = setTimeout(() => {
    timed = true
    proc.kill(9)
  }, Math.max(1, capMs))
  await proc.exited
  clearTimeout(killer)
  const out = await new Response(proc.stdout).text().catch(() => "")
  const errs = await new Response(proc.stderr).text().catch(() => "")
  await unlink(script).catch(() => undefined)
  const merged = [out, errs].filter(Boolean).join(out && errs ? "\n" : "")
  return { output: merged, exitCode: timed ? 124 : proc.exitCode ?? 0 }
}

async function sweep() {
  const now = Date.now()
  const stale = [...sessions.entries()].filter(([, s]) => now - s.last > idle)
  await Promise.all(
    stale.map(async ([id, s]) => {
      log("info", "session idle cleanup", { id })
      sessions.delete(id)
      await drop(s)
    }),
  )
}

setInterval(sweep, 30000)

async function reapStaleSessions() {
  const p = join(dataRoot, "sessions")
  const dirs = (await readdir(p, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory())
  if (!dirs.length) return
  await Promise.all(dirs.map((d) => rm(join(p, d.name), { recursive: true, force: true }).catch(() => undefined)))
  log("warn", "reaped orphan session dirs", { n: dirs.length })
}

app.use("*", async (c, next) => {
  const t0 = Date.now()
  await next()
  log("info", `${c.req.method} ${c.req.path}`, { status: c.res.status, duration: Date.now() - t0 })
})

app.get("/livez", (c) => c.text("ok"))
app.get("/readyz", async (c) => {
  const body = await readyzPayload()
  return c.json(body, body.ok ? 200 : 503)
})

app.post("/v1/sessions/:sessionId/exec", async (c) => {
  const id = c.req.param("sessionId")
  const body = (await c.req.json()) as { code?: string; workdir?: string; timeout?: number }
  const code = body.code
  const cap = body.timeout ?? 120000
  if (!code || typeof code !== "string") return c.json({ error: "Missing or invalid code" }, 400)
  if (body.workdir !== undefined && typeof body.workdir !== "string")
    return c.json({ error: "Invalid workdir" }, 400)

  let s: Session
  try {
    const b = await readyzPayload()
    if (!b.ok) return c.json({ error: "executor not ready", errors: b.errors }, 503)
    s = await ensure(id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log("error", "session ensure failed", { id, msg })
    return c.json({ error: "session init failed", message: msg }, 503)
  }

  try {
    const r = await run(s, code, cap, body.workdir)
    return c.json({
      output: r.output,
      exitCode: r.exitCode,
      sessionId: s.id,
      mode: "micropython",
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log("error", "exec failed", { id, msg })
    return c.json({ error: "Execution failed", message: msg }, 500)
  }
})

app.get("/v1/sessions/:sessionId/status", (c) => {
  const id = c.req.param("sessionId")
  const s = sessions.get(id)
  if (!s) return c.json({ error: "Session not found" }, 404)
  return c.json({
    sessionId: s.id,
    createdAt: s.created,
    lastActivity: s.last,
    mode: "micropython",
  })
})

app.post("/v1/sessions/:sessionId/close", async (c) => {
  const id = c.req.param("sessionId")
  const s = sessions.get(id)
  if (!s) return c.json({ error: "Session not found" }, 404)
  sessions.delete(id)
  await drop(s)
  return c.json({ status: "closed" })
})

app.get("/v1/admin/sessions", (c) => {
  const list = [...sessions.values()].map((s) => ({
    id: s.id,
    createdAt: s.created,
    lastActivity: s.last,
  }))
  return c.json({ sessions: list })
})

async function shutdown() {
  log("info", "shutting down executor")
  await Promise.all([...sessions.values()].map((s) => drop(s)))
  sessions.clear()
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

const port = Number(process.env.PORT ?? "7777")
log("info", `Executor API on port ${port} (micropython=${bin})`)
await reapStaleSessions().catch(() => undefined)
Bun.serve({ port, fetch: app.fetch })
