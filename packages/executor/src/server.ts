import { Hono } from "hono"
import { execFileSync } from "child_process"
import { constants } from "fs"
import { existsSync } from "node:fs"
import { access, copyFile, mkdir, readdir, rm } from "fs/promises"
import { join } from "path"
import { NodeSSH } from "node-ssh"
import { FIRECRACKER_PATH, firecrackerVersion, start, stop, type FirecrackerVm } from "./vm/firecracker"

const pkgOut = join(import.meta.dir, "../output")
const VM_INACTIVITY_TIMEOUT_MS = Number(process.env.VM_INACTIVITY_TIMEOUT_MS ?? "300000")
const VM_DATA_DIR = process.env.VM_DATA_DIR ?? "/tmp/veritly-vms"
const ROOTFS_PATH = process.env.ROOTFS_PATH?.trim() || join(pkgOut, "rootfs.ext4")
const KERNEL_PATH = process.env.KERNEL_PATH?.trim() || join(pkgOut, "vmlinux")
const INITRD_PATH = process.env.INITRD_PATH?.trim() || join(pkgOut, "initrd.img")
const SSH_HOST = process.env.SSH_HOST ?? "127.0.0.1"
const SSH_BOOT_TIMEOUT_MS = Number(process.env.SSH_BOOT_TIMEOUT_MS ?? "90000")

type Session = {
  id: string
  runtime: "firecracker"
  workspaceDir: string
  vmDir: string
  vm: FirecrackerVm
  sshPort: number
  ssh: NodeSSH
  createdAt: number
  lastActivity: number
}

const app = new Hono()
const sessions = new Map<string, Session>()

function log(level: "info" | "error" | "warn", message: string, meta?: object) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] [${level}] ${message}`, meta ? JSON.stringify(meta) : "")
}

function pids(path: string): number[] {
  try {
    const out = execFileSync("lsof", ["-t", path], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
    if (!out) return []
    return out
      .split(/\s+/)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 1)
  } catch {
    return []
  }
}

function kill(pid: number) {
  try {
    process.kill(pid, "SIGTERM")
  } catch {}
  try {
    process.kill(pid, "SIGKILL")
  } catch {}
}

function haveInitrd() {
  return existsSync(INITRD_PATH)
}

async function ready() {
  try {
    await access(FIRECRACKER_PATH, constants.X_OK)
    const rootfs = await Bun.file(ROOTFS_PATH).stat()
    if (rootfs.size <= 1024 * 1024) return false
    await access(KERNEL_PATH, constants.R_OK)
    if (!haveInitrd()) return false
    await access(INITRD_PATH, constants.R_OK)
    if (process.platform === "linux") await access("/dev/kvm", constants.R_OK | constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function ensureReady() {
  await access(FIRECRACKER_PATH, constants.X_OK)
  const rootfs = await Bun.file(ROOTFS_PATH).stat()
  if (rootfs.size <= 1024 * 1024) throw new Error(`ROOTFS_PATH is not a real VM image: ${ROOTFS_PATH}`)
  await access(KERNEL_PATH, constants.R_OK)
  if (!haveInitrd()) throw new Error(`INITRD_PATH is required for guest boot: ${INITRD_PATH}`)
  await access(INITRD_PATH, constants.R_OK)
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
  const rootfsPath = join(vmDir, "rootfs.ext4")
  await mkdir(workspaceDir, { recursive: true })
  await mkdir(vmDir, { recursive: true })
  await copyFile(ROOTFS_PATH, rootfsPath)

  try {
    const vm = await start({ id, dir: vmDir, rootfsPath })
    const ssh = new NodeSSH()
    await waitForSSH(ssh, SSH_HOST, vm.sshPort)
    const session: Session = {
      id,
      runtime: "firecracker",
      workspaceDir,
      vmDir,
      vm,
      sshPort: vm.sshPort,
      ssh,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    }
    sessions.set(id, session)
    log("info", "Created firecracker session", { id, sshPort: vm.sshPort })
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
  for (const [id, session] of sessions) {
    if (now - session.lastActivity <= VM_INACTIVITY_TIMEOUT_MS) continue
    log("info", "Cleaning up inactive session", { id })
    sessions.delete(id)
    await drop(session)
  }
}

setInterval(cleanupInactiveSessions, 30000)

async function reapOrphanVms() {
  const root = join(VM_DATA_DIR, "vms")
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => [])
  if (!dirs.length) return
  let removed = 0
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const vmDir = join(root, dir.name)
    const rootfs = join(vmDir, "rootfs.ext4")
    for (const id of pids(rootfs)) kill(id)
    await rm(vmDir, { recursive: true, force: true }).catch(() => undefined)
    removed++
  }
  if (removed > 0) log("warn", "Reaped orphan VM dirs from previous executor run", { removed })
}

async function health() {
  const ok = await ready()
  return {
    ok,
    service: "executor",
    mode: "firecracker" as const,
    guest: "x86_64" as const,
    firecrackerVersion: firecrackerVersion(),
    activeSessions: sessions.size,
    ready: ok,
  }
}

app.use("*", async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  log("info", `${c.req.method} ${c.req.path}`, { status: c.res.status, duration })
})

app.get("/livez", (c) => c.text("ok"))
app.get("/readyz", async (c) => {
  const status = await health()
  return c.json(status, status.ok ? 200 : 503)
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
  for (const [, session] of sessions) await drop(session)
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

const port = Number(process.env.PORT ?? "7777")
log("info", `Executor API starting on port ${port} (guest=x86_64 firecracker=${FIRECRACKER_PATH})`)
await reapOrphanVms()
Bun.serve({ port, fetch: app.fetch })
