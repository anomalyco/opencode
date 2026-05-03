import { Hono } from "hono"
import { existsSync } from "node:fs"
import { cp, mkdir, readdir, readFile, rm } from "fs/promises"
import { join } from "path"
import { NodeSSH } from "node-ssh"
import type { ReadyzBody } from "./readyz-probe"
import { runReadyzProbe } from "./readyz-probe"
import { guestKind, qemuBinary, start, stop, type GuestKind, type QemuVm } from "./vm/qemu"

const pkgOut = join(import.meta.dir, "../output")
const VM_INACTIVITY_TIMEOUT_MS = Number(process.env.VM_INACTIVITY_TIMEOUT_MS ?? "300000")
const VM_DATA_DIR = process.env.VM_DATA_DIR ?? "/tmp/veritly-vms"
const SSH_HOST = process.env.SSH_HOST ?? "127.0.0.1"
const SSH_BOOT_TIMEOUT_MS = Number(process.env.SSH_BOOT_TIMEOUT_MS ?? "180000")

function bundle(kind: GuestKind) {
  return join(pkgOut, kind)
}

function kernelPath(kind: GuestKind) {
  const p = process.env.KERNEL_PATH?.trim()
  if (p) return p
  return join(bundle(kind), "vmlinuz")
}

function initrdPath(kind: GuestKind) {
  const p = process.env.INITRD_PATH?.trim()
  if (p) return p
  return join(bundle(kind), "initrd.img")
}

function templateDir(kind: GuestKind) {
  return join(bundle(kind), "guest-root")
}

type Session = {
  id: string
  runtime: "qemu"
  workspaceDir: string
  vmDir: string
  vm: QemuVm
  sshPort: number
  ssh: NodeSSH
  createdAt: number
  lastActivity: number
}

const app = new Hono()
const sessions = new Map<string, Session>()
const kind = guestKind()

const readyzMs = Number(process.env.READYZ_INTERVAL_MS ?? "60000")
let readyzCache: { at: number; body: ReadyzBody } | null = null
let readyzLock: Promise<ReadyzBody> | null = null

async function readyzPayload(): Promise<ReadyzBody> {
  if (readyzMs > 0 && readyzCache && Date.now() - readyzCache.at < readyzMs)
    return { ...readyzCache.body, cached: true, cachedAgeMs: Date.now() - readyzCache.at }
  readyzLock ??= runReadyzProbe({
    kind,
    pkgOut,
    vmData: VM_DATA_DIR,
    sshHost: SSH_HOST,
    sshBootMs: SSH_BOOT_TIMEOUT_MS,
    activeSessions: sessions.size,
  })
    .then((b) => {
      readyzCache = { at: Date.now(), body: { ...b, cached: false } }
      return b
    })
    .finally(() => {
      readyzLock = null
    })
  return await readyzLock
}

function log(level: "info" | "error" | "warn", message: string, meta?: object) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] [${level}] ${message}`, meta ? JSON.stringify(meta) : "")
}

async function templateOk() {
  const p = join(templateDir(kind), "bin", "busybox")
  const s = await Bun.file(p).stat().catch(() => null)
  return Boolean(s && s.size >= 1000)
}

async function ensureReady() {
  if (!Bun.spawnSync([qemuBinary(kind), "--version"], { stdout: "ignore", stderr: "ignore" }).success)
    throw new Error(`QEMU not runnable: ${qemuBinary(kind)}`)
  const k = kernelPath(kind)
  const ks = await Bun.file(k).stat().catch(() => null)
  if (!ks || ks.size < 4096) throw new Error(`KERNEL missing or empty: ${k}`)
  if (!(await templateOk())) throw new Error(`guest template invalid: ${templateDir(kind)}`)
  const i = initrdPath(kind)
  if (existsSync(i)) {
    const is = await Bun.file(i).stat().catch(() => null)
    if (!is || is.size < 1024) throw new Error(`INITRD invalid: ${i}`)
  }
}

async function waitForSSH(ssh: NodeSSH, host: string, port: number) {
  const end = Date.now() + SSH_BOOT_TIMEOUT_MS
  let err: unknown
  while (Date.now() < end) {
    try {
      await ssh.connect({ host, port, username: "root", password: "root", readyTimeout: 5000 })
      return
    } catch (next) {
      err = next
      await Bun.sleep(500)
    }
  }
  throw new Error(
    `Timed out waiting for VM SSH at ${host}:${port}: ${err instanceof Error ? err.message : String(err)}`,
  )
}

async function drop(session: Session) {
  session.ssh.dispose()
  await stop(session.vm)
  await rm(session.vmDir, { recursive: true, force: true }).catch(() => undefined)
  await rm(session.workspaceDir, { recursive: true, force: true }).catch(() => undefined)
}

async function createSession(id: string) {
  await ensureReady()
  const workspaceDir = join(VM_DATA_DIR, "sessions", id)
  const vmDir = join(VM_DATA_DIR, "vms", id)
  const root = join(vmDir, "root")
  await mkdir(workspaceDir, { recursive: true })
  await mkdir(vmDir, { recursive: true })
  await cp(templateDir(kind), root, { recursive: true })

  const initrd = existsSync(initrdPath(kind)) ? initrdPath(kind) : undefined
  try {
    const vm = await start({
      id,
      dir: vmDir,
      rootfsDir: root,
      kernel: kernelPath(kind),
      initrd,
      kind,
    })
    const ssh = new NodeSSH()
    await waitForSSH(ssh, SSH_HOST, vm.sshPort)
    const session: Session = {
      id,
      runtime: "qemu",
      workspaceDir,
      vmDir,
      vm,
      sshPort: vm.sshPort,
      ssh,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    }
    sessions.set(id, session)
    log("info", "Created qemu session", { id, sshPort: vm.sshPort })
    return session
  } catch (err) {
    await rm(vmDir, { recursive: true, force: true }).catch(() => undefined)
    await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
}

async function exec(session: Session, command: string, timeout: number) {
  session.lastActivity = Date.now()
  const escaped = command.replaceAll("'", `'\\''`)
  const script = `cd /workspace && timeout ${Math.max(1, Math.ceil(timeout / 1000))}s sh -lc '${escaped}'`
  const out = await session.ssh.execCommand(script)
  return {
    output: [out.stdout, out.stderr].filter(Boolean).join(out.stdout && out.stderr ? "\n" : ""),
    exitCode: out.code ?? 0,
  }
}

async function cleanupInactiveSessions() {
  const now = Date.now()
  const stale = Array.from(sessions.entries()).filter(([, s]) => now - s.lastActivity > VM_INACTIVITY_TIMEOUT_MS)
  await Promise.all(
    stale.map(async ([id, session]) => {
      log("info", "Cleaning up inactive session", { id })
      sessions.delete(id)
      await drop(session)
    }),
  )
}

setInterval(cleanupInactiveSessions, 30000)

async function reapOne(vmDir: string) {
  const raw = await readFile(join(vmDir, "qemu.pid"), "utf8").catch(() => "")
  const pid = Number(raw.trim())
  if (Number.isFinite(pid) && pid > 1)
    Bun.spawnSync(["kill", "-9", String(pid)], { stderr: "ignore", stdout: "ignore" })
  await rm(vmDir, { recursive: true, force: true }).catch(() => undefined)
}

async function reapOrphanVms() {
  const root = join(VM_DATA_DIR, "vms")
  const dirs = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory())
  if (!dirs.length) return
  await Promise.all(dirs.map((d) => reapOne(join(root, d.name))))
  log("warn", "Reaped orphan VM dirs from previous executor run", { removed: dirs.length })
}

async function reapProbeDirs() {
  const root = join(VM_DATA_DIR, "readyz-probes")
  const dirs = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory())
  if (!dirs.length) return
  await Promise.all(dirs.map((d) => rm(join(root, d.name), { recursive: true, force: true }).catch(() => undefined)))
  log("warn", "Reaped stale readyz-probes dirs", { removed: dirs.length })
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
  const body = (await c.req.json()) as { command?: string; timeout?: number }
  const command = body.command
  const timeout = body.timeout ?? 120000

  if (!command || typeof command !== "string") return c.json({ error: "Missing or invalid command" }, 400)

  let session = sessions.get(id)
  if (!session) {
    try {
      session = await createSession(id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log("error", "VM creation failed", { id, err: msg })
      return c.json({ error: "VM creation failed", message: msg }, 503)
    }
  }

  try {
    const result = await exec(session, command, timeout)
    return c.json({
      output: result.output,
      exitCode: result.exitCode,
      sessionId: session.id,
      vmId: session.id,
      mode: session.runtime,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log("error", "Command execution failed", { id, err: msg })
    return c.json({ error: "Execution failed", message: msg }, 500)
  }
})

app.get("/v1/sessions/:sessionId/status", async (c) => {
  const id = c.req.param("sessionId")
  const session = sessions.get(id)
  if (!session) return c.json({ error: "Session not found" }, 404)
  return c.json({
    sessionId: session.id,
    createdAt: session.createdAt,
    lastActivity: session.lastActivity,
    mode: session.runtime,
    vmId: session.id,
    sshPort: session.sshPort,
  })
})

app.post("/v1/sessions/:sessionId/close", async (c) => {
  const id = c.req.param("sessionId")
  const session = sessions.get(id)
  if (!session) return c.json({ error: "Session not found" }, 404)
  sessions.delete(id)
  await drop(session)
  return c.json({ status: "closed" })
})

app.get("/v1/admin/sessions", (c) => {
  const list = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
  }))
  return c.json({ sessions: list })
})

async function shutdown() {
  log("info", "Shutting down executor...")
  await Promise.all(Array.from(sessions.values()).map((s) => drop(s)))
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

const port = Number(process.env.PORT ?? "7777")
log("info", `Executor API on port ${port} (guest=${kind} qemu=${qemuBinary(kind)})`)
await reapOrphanVms()
await reapProbeDirs()
Bun.serve({ port, fetch: app.fetch })
