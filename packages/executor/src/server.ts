import { Hono } from "hono"
import { spawn } from "child_process"
import { constants } from "fs"
import { access, copyFile, mkdir, rm } from "fs/promises"
import { join } from "path"
import { NodeSSH } from "node-ssh"

// Configuration
const VM_INACTIVITY_TIMEOUT_MS = Number(process.env.VM_INACTIVITY_TIMEOUT_MS ?? "300000")
const VM_DATA_DIR = process.env.VM_DATA_DIR ?? "/tmp/veritly-vms"
const FIRECRACKER_BINARY = process.env.FIRECRACKER_BINARY ?? "/usr/local/bin/firecracker"
const KERNEL_PATH = process.env.KERNEL_PATH ?? "/opt/veritly/vmlinux"
const ROOTFS_PATH = process.env.ROOTFS_PATH ?? "/opt/veritly/rootfs.ext4"
const GUEST_IP_BASE = process.env.GUEST_IP_BASE ?? "172.16"
const SSH_BOOT_TIMEOUT_MS = Number(process.env.SSH_BOOT_TIMEOUT_MS ?? "30000")
const EXECUTOR_RUNTIME = process.env.EXECUTOR_RUNTIME === "dangerous-local" ? "dangerous-local" : "firecracker"

const app = new Hono()

// Session state
type Session = {
  id: string
  runtime: "firecracker" | "dangerous-local"
  workspaceDir: string
  vmDir?: string
  socketPath?: string
  rootfsPath?: string
  tapName?: string
  guestIP?: string
  ssh?: NodeSSH
  proc?: ReturnType<typeof spawn>
  createdAt: number
  lastActivity: number
}

const sessions = new Map<string, Session>()

// Logging
function log(level: "info" | "error" | "warn", message: string, meta?: object) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] [${level}] ${message}`, meta ? JSON.stringify(meta) : "")
}

// Check if Firecracker is available
async function firecrackerAvailable(): Promise<boolean> {
  try {
    await access(FIRECRACKER_BINARY)
    await access("/dev/kvm")
    // Also check rootfs is valid
    const stats = await Bun.file(ROOTFS_PATH).stat()
    return stats.size > 1000000 // At least 1MB
  } catch {
    return false
  }
}

// Cleanup inactive sessions
async function cleanupInactiveSessions() {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > VM_INACTIVITY_TIMEOUT_MS) {
      log("info", "Cleaning up inactive session", { id })
      sessions.delete(id)
      await drop(session)
    }
  }
}

setInterval(cleanupInactiveSessions, 30000)

// Create new session
async function createSession(sessionId: string): Promise<Session> {
  if (EXECUTOR_RUNTIME === "dangerous-local") return createDangerousLocalSession(sessionId)

  const workspaceDir = join(VM_DATA_DIR, "sessions", sessionId)
  const vmDir = join(VM_DATA_DIR, "vms", sessionId)
  await mkdir(workspaceDir, { recursive: true })
  await mkdir(vmDir, { recursive: true })
  await ensureFirecrackerAvailable()

  const socketPath = join(vmDir, "firecracker.sock")
  const rootfsPath = join(vmDir, "rootfs.ext4")
  const tapName = `vt${hashSession(sessionId).slice(0, 9)}`
  const guestIP = guestIPFor(sessionId)

  await rm(socketPath, { force: true }).catch(() => undefined)
  await copyFile(ROOTFS_PATH, rootfsPath)

  await setupTap(tapName, guestIP)
  const proc = spawn(FIRECRACKER_BINARY, ["--api-sock", socketPath], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  proc.stdout?.on("data", (chunk) => log("info", "firecracker stdout", { sessionId, line: chunk.toString() }))
  proc.stderr?.on("data", (chunk) => log("warn", "firecracker stderr", { sessionId, line: chunk.toString() }))

  await waitForSocket(socketPath)
  await configureFirecracker({ socketPath, rootfsPath, tapName, guestIP })
  await firecrackerPut(socketPath, "/actions", { action_type: "InstanceStart" })

  const ssh = new NodeSSH()
  await waitForSSH(ssh, guestIP)

  const session: Session = {
    id: sessionId,
    runtime: "firecracker",
    workspaceDir,
    vmDir,
    socketPath,
    rootfsPath,
    tapName,
    guestIP,
    ssh,
    proc,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  }

  sessions.set(sessionId, session)
  log("info", "Created session", { sessionId, workspaceDir })
  return session
}

async function createDangerousLocalSession(sessionId: string): Promise<Session> {
  const workspaceDir = join(VM_DATA_DIR, "sessions", sessionId)
  await mkdir(workspaceDir, { recursive: true })
  const session: Session = {
    id: sessionId,
    runtime: "dangerous-local",
    workspaceDir,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  }
  sessions.set(sessionId, session)
  log("warn", "Created dangerous-local session", { sessionId, workspaceDir })
  return session
}

async function drop(session: Session) {
  session.ssh?.dispose()
  session.proc?.kill("SIGTERM")
  if (session.tapName) await run("ip", ["link", "del", session.tapName]).catch(() => undefined)
  if (session.vmDir) await rm(session.vmDir, { recursive: true, force: true }).catch(() => undefined)
  await rm(session.workspaceDir, { recursive: true, force: true }).catch(() => undefined)
}

async function self() {
  if (EXECUTOR_RUNTIME === "dangerous-local") {
    return {
      ok: true,
      service: "executor",
      mode: "dangerous-local",
      activeSessions: sessions.size,
      ready: true,
    }
  }

  const firecracker = await firecrackerAvailable()
  return {
    ok: firecracker,
    service: "executor",
    mode: "firecracker",
    activeSessions: sessions.size,
    ready: firecracker,
  }
}

// Execute command in session
async function executeCommand(
  session: Session,
  command: string,
  timeout: number,
): Promise<{ output: string; exitCode: number }> {
  session.lastActivity = Date.now()
  if (session.runtime === "dangerous-local") return executeDangerousLocalCommand(session, command, timeout)

  const escaped = command.replaceAll("'", `'\\''`)
  const script = `cd /workspace && timeout ${Math.max(1, Math.ceil(timeout / 1000))}s sh -lc '${escaped}'`
  if (!session.ssh) throw new Error("Firecracker session is missing SSH connection")
  const result = await session.ssh.execCommand(script)
  return {
    output: [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? "\n" : ""),
    exitCode: result.code ?? 0,
  }
}

async function executeDangerousLocalCommand(
  session: Session,
  command: string,
  timeout: number,
): Promise<{ output: string; exitCode: number }> {
  await mkdir(session.workspaceDir, { recursive: true })
  return new Promise((resolve) => {
    const workspace = session.workspaceDir.replaceAll("'", `'\\''`)
    const script = command.replaceAll("/workspace", workspace)
    const proc = spawn("sh", ["-lc", script], {
      cwd: session.workspaceDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill("SIGTERM")
      setTimeout(() => proc.kill("SIGKILL"), 1000).unref()
    }, timeout)
    proc.stdout?.on("data", (chunk) => (output += chunk.toString()))
    proc.stderr?.on("data", (chunk) => (output += chunk.toString()))
    proc.on("error", (error) => {
      clearTimeout(timer)
      resolve({ output: error.message, exitCode: 1 })
    })
    proc.on("close", (code) => {
      clearTimeout(timer)
      resolve({
        output: timedOut ? `${output}\nCommand timed out after ${timeout}ms`.trim() : output,
        exitCode: timedOut ? 124 : (code ?? 0),
      })
    })
  })
}

async function ensureFirecrackerAvailable() {
  await access(FIRECRACKER_BINARY, constants.X_OK)
  await access("/dev/kvm", constants.R_OK | constants.W_OK)
  const rootfs = await Bun.file(ROOTFS_PATH).stat()
  if (rootfs.size <= 1024 * 1024) throw new Error(`ROOTFS_PATH is not a real VM image: ${ROOTFS_PATH}`)
  await access(KERNEL_PATH, constants.R_OK)
}

function hashSession(sessionId: string) {
  let hash = 2166136261
  for (const char of sessionId) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function guestIPFor(sessionId: string) {
  const value = Number.parseInt(hashSession(sessionId).slice(0, 4), 16)
  const third = 10 + (value % 200)
  const fourth = 2 + (Math.floor(value / 200) % 200)
  return `${GUEST_IP_BASE}.${third}.${fourth}`
}

function hostIPFor(guestIP: string) {
  return guestIP.replace(/\.\d+$/, ".1")
}

async function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    proc.stdout?.on("data", (chunk) => (output += chunk.toString()))
    proc.stderr?.on("data", (chunk) => (output += chunk.toString()))
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${output}`))
    })
  })
}

async function setupTap(tapName: string, guestIP: string) {
  const hostIP = hostIPFor(guestIP)
  await run("ip", ["link", "del", tapName]).catch(() => undefined)
  await run("ip", ["tuntap", "add", tapName, "mode", "tap"])
  await run("ip", ["addr", "add", `${hostIP}/24`, "dev", tapName])
  await run("ip", ["link", "set", tapName, "up"])
}

async function waitForSocket(socketPath: string) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await Bun.file(socketPath).exists()) return
    await Bun.sleep(50)
  }
  throw new Error(`Firecracker API socket did not appear: ${socketPath}`)
}

async function firecrackerPut(socketPath: string, path: string, body: unknown) {
  const response = await fetch(`http://unix${path}`, {
    method: "PUT",
    unix: socketPath,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Firecracker ${path} failed (${response.status}): ${await response.text()}`)
}

async function configureFirecracker(input: { socketPath: string; rootfsPath: string; tapName: string; guestIP: string }) {
  const hostIP = hostIPFor(input.guestIP)
  await firecrackerPut(input.socketPath, "/machine-config", {
    vcpu_count: 1,
    mem_size_mib: 1024,
    smt: false,
  })
  await firecrackerPut(input.socketPath, "/boot-source", {
    kernel_image_path: KERNEL_PATH,
    boot_args: [
      "console=ttyS0",
      "reboot=k",
      "panic=1",
      "pci=off",
      `ip=${input.guestIP}::${hostIP}:255.255.255.0::eth0:off`,
      "init=/usr/local/bin/start-vm.sh",
    ].join(" "),
  })
  await firecrackerPut(input.socketPath, "/drives/rootfs", {
    drive_id: "rootfs",
    path_on_host: input.rootfsPath,
    is_root_device: true,
    is_read_only: false,
  })
  await firecrackerPut(input.socketPath, "/network-interfaces/eth0", {
    iface_id: "eth0",
    host_dev_name: input.tapName,
  })
}

async function waitForSSH(ssh: NodeSSH, host: string) {
  const deadline = Date.now() + SSH_BOOT_TIMEOUT_MS
  let last: unknown
  while (Date.now() < deadline) {
    try {
      await ssh.connect({ host, username: "root", password: "root", readyTimeout: 3000 })
      return
    } catch (err) {
      last = err
      await Bun.sleep(500)
    }
  }
  throw new Error(`Timed out waiting for VM SSH at ${host}: ${last instanceof Error ? last.message : String(last)}`)
}

// HTTP Routes
app.use("*", async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  log("info", `${c.req.method} ${c.req.path}`, { status: c.res.status, duration })
})

app.get("/livez", (c) => c.text("ok"))
app.get("/healthz", async (c) => {
  const status = await self()
  return c.json(status, status.ok ? 200 : 503)
})
app.get("/health", async (c) => {
  const status = await self()
  return c.json(status, status.ok ? 200 : 503)
})

// Execute bash command
app.post("/v1/sessions/:sessionId/exec", async (c) => {
  const sessionId = c.req.param("sessionId")
  const body = await c.req.json()
  const { command, timeout = 120000 } = body

  if (!command || typeof command !== "string") {
    return c.json({ error: "Missing or invalid command" }, 400)
  }

  let session = sessions.get(sessionId)
  if (!session) {
    try {
      session = await createSession(sessionId)
    } catch (error: any) {
      log("error", "VM creation failed", { sessionId, error: error.message })
      return c.json({ error: "VM creation failed", message: error.message }, 503)
    }
  }

  try {
    const result = await executeCommand(session, command, timeout)
    return c.json({
      output: result.output,
      exitCode: result.exitCode,
      sessionId: session.id,
      vmId: session.id,
      mode: session.runtime,
    })
  } catch (error: any) {
    log("error", "Command execution failed", { sessionId, error: error.message })
    return c.json({ error: "Execution failed", message: error.message }, 500)
  }
})

// Get session status
app.get("/v1/sessions/:sessionId/status", async (c) => {
  const sessionId = c.req.param("sessionId")
  const session = sessions.get(sessionId)

  if (!session) {
    return c.json({ error: "Session not found" }, 404)
  }

  return c.json({
    sessionId: session.id,
    createdAt: session.createdAt,
    lastActivity: session.lastActivity,
    mode: session.runtime,
    vmId: session.id,
    guestIP: session.guestIP,
  })
})

// Close session
app.post("/v1/sessions/:sessionId/close", async (c) => {
  const sessionId = c.req.param("sessionId")
  const session = sessions.get(sessionId)

  if (!session) {
    return c.json({ error: "Session not found" }, 404)
  }

  sessions.delete(sessionId)
  await drop(session)

  return c.json({ status: "closed" })
})

// List sessions (admin)
app.get("/v1/admin/sessions", (c) => {
  const list = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
  }))
  return c.json({ sessions: list })
})

// Graceful shutdown
async function shutdown() {
  log("info", "Shutting down executor...")
  for (const [id, session] of sessions) {
    await drop(session)
  }
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

// Start server
const port = Number(process.env.PORT ?? "7777")
log("info", `Executor API starting on port ${port}`)

Bun.serve({
  port,
  fetch: app.fetch,
})
