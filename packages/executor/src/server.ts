import { Hono } from "hono"
import { v4 as uuidv4 } from "uuid"
import { spawn } from "child_process"
import { writeFile, mkdir, unlink, access, rmdir } from "fs/promises"
import { join } from "path"

// Configuration
const VM_INACTIVITY_TIMEOUT_MS = Number(process.env.VM_INACTIVITY_TIMEOUT_MS ?? "300000")
const VM_DATA_DIR = process.env.VM_DATA_DIR ?? "/tmp/veritly-vms"
const FIRECRACKER_BINARY = process.env.FIRECRACKER_BINARY ?? "/usr/local/bin/firecracker"
const KERNEL_PATH = process.env.KERNEL_PATH ?? "/opt/veritly/vmlinux"
const ROOTFS_PATH = process.env.ROOTFS_PATH ?? "/opt/veritly/rootfs.ext4"

const app = new Hono()

// Session state
type Session = {
  id: string
  workspaceDir: string
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
      try {
        await rmdir(session.workspaceDir, { recursive: true })
      } catch {
        // Ignore
      }
    }
  }
}

setInterval(cleanupInactiveSessions, 30000)

// Create new session
async function createSession(sessionId: string): Promise<Session> {
  const workspaceDir = join(VM_DATA_DIR, "sessions", sessionId)
  await mkdir(workspaceDir, { recursive: true })

  const session: Session = {
    id: sessionId,
    workspaceDir,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  }

  sessions.set(sessionId, session)
  log("info", "Created session", { sessionId, workspaceDir })
  return session
}

// Execute command in session
async function executeCommand(
  session: Session,
  command: string,
  timeout: number,
): Promise<{ output: string; exitCode: number }> {
  session.lastActivity = Date.now()

  // Replace absolute /workspace references with the session's actual workspace
  const adjustedCommand = command.replace(/\/workspace/g, session.workspaceDir)

  return new Promise((resolve) => {
    const proc = spawn(adjustedCommand, {
      shell: true,
      cwd: session.workspaceDir,
      env: {
        ...process.env,
        HOME: "/root",
        WORKSPACE: session.workspaceDir,
      },
    })

    let output = ""
    let killed = false

    const timeoutTimer = setTimeout(() => {
      killed = true
      proc.kill("SIGTERM")
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL")
      }, 1000)
    }, timeout)

    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString()
    })

    proc.stderr?.on("data", (chunk) => {
      output += chunk.toString()
    })

    proc.on("close", (code) => {
      clearTimeout(timeoutTimer)
      resolve({
        output: killed ? output + "\nCommand timed out" : output,
        exitCode: killed ? 124 : (code ?? 0),
      })
    })

    proc.on("error", (error) => {
      clearTimeout(timeoutTimer)
      resolve({
        output: `Error: ${error.message}`,
        exitCode: 1,
      })
    })
  })
}

// HTTP Routes
app.use("*", async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  log("info", `${c.req.method} ${c.req.path}`, { status: c.res.status, duration })
})

// Health check
app.get("/health", async (c) => {
  const useFirecracker = await firecrackerAvailable()
  return c.json({
    status: "ok",
    mode: useFirecracker ? "firecracker" : "container",
    activeSessions: sessions.size,
  })
})

// Execute bash command
app.post("/v1/sessions/:sessionId/exec", async (c) => {
  const sessionId = c.req.param("sessionId")
  const body = await c.req.json()
  const { command, timeout = 120000 } = body

  if (!command || typeof command !== "string") {
    return c.json({ error: "Missing or invalid command" }, 400)
  }

  // Check if Firecracker is available
  const useFirecracker = await firecrackerAvailable()
  if (useFirecracker) {
    return c.json(
      {
        error: "Firecracker mode not yet implemented",
        message: "Use container mode for now",
      },
      501,
    )
  }

  // Container mode
  let session = sessions.get(sessionId)
  if (!session) {
    session = await createSession(sessionId)
  }

  try {
    const result = await executeCommand(session, command, timeout)
    return c.json({
      output: result.output,
      exitCode: result.exitCode,
      sessionId: session.id,
      mode: "container",
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
    mode: "container",
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
  try {
    await rmdir(session.workspaceDir, { recursive: true })
  } catch {
    // Ignore
  }

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
    try {
      await rmdir(session.workspaceDir, { recursive: true })
    } catch {
      // Ignore
    }
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
