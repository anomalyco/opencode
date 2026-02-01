/**
 * Broker-backed PTY session management.
 *
 * This module manages PTY sessions spawned through the auth broker.
 * The broker holds the master_fd and spawns processes as the authenticated user.
 * I/O flows through IPC calls (ptyWrite/ptyRead).
 */

import { BrokerClient } from "@/auth/broker-client"
import type { WSContext } from "hono/ws"
import { Log } from "@/util/log"

const log = Log.create({ service: "broker-pty" })

const BUFFER_LIMIT = 1024 * 1024 * 2

/**
 * Information about a broker-managed PTY session.
 */
export interface BrokerPtyInfo {
  /** Local tracking ID (same as ptyId for simplicity) */
  id: string
  /** Broker's PTY session ID */
  ptyId: string
  /** Process ID of the spawned shell */
  pid: number
  /** Web session ID this PTY belongs to */
  sessionId: string
  /** Current PTY status */
  status: "running" | "exited"
}

/**
 * Internal session state for a broker PTY.
 */
interface BrokerPtySession {
  info: BrokerPtyInfo
  /** WebSocket subscribers for PTY output */
  subscribers: Set<WSContext>
  /** Buffered output when no subscribers connected */
  buffer: string
}

/** Active broker PTY sessions by ID */
const sessions = new Map<string, BrokerPtySession>()

/**
 * Create a broker-backed PTY session.
 *
 * Calls the broker to spawn a PTY as the authenticated user.
 * The broker allocates the PTY pair and spawns the user's shell.
 *
 * @param sessionId - Web session ID (must be registered with broker)
 * @param options - PTY configuration options
 * @returns PTY info with ID and PID
 *
 * @example
 * ```typescript
 * const info = await BrokerPty.create(session.id, {
 *   cols: 120,
 *   rows: 40,
 * })
 * console.log(`Spawned PTY ${info.ptyId} with PID ${info.pid}`)
 * ```
 */
export async function create(
  sessionId: string,
  options: { term?: string; cols?: number; rows?: number; env?: Record<string, string> } = {},
  requestId?: string,
): Promise<BrokerPtyInfo> {
  const brokerClient = new BrokerClient()

  const result = await brokerClient.spawnPty(
    sessionId,
    {
      term: options.term ?? "xterm-256color",
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      env: options.env ?? {},
    },
    requestId,
  )

  if (!result.success || !result.ptyId || !result.pid) {
    throw new Error(result.error ?? "Failed to spawn PTY via broker")
  }

  const info: BrokerPtyInfo = {
    id: result.ptyId,
    ptyId: result.ptyId,
    pid: result.pid,
    sessionId,
    status: "running",
  }

  const session: BrokerPtySession = {
    info,
    subscribers: new Set(),
    buffer: "",
  }

  sessions.set(info.id, session)

  log.info("Broker PTY created", {
    ptyId: info.ptyId,
    pid: info.pid,
    sessionId,
    requestId,
    method: "spawnpty",
  })

  return info
}

/**
 * Get a broker PTY session by ID.
 *
 * @param id - PTY session ID
 * @returns PTY info or undefined if not found
 */
export function get(id: string): BrokerPtyInfo | undefined {
  return sessions.get(id)?.info
}

/**
 * List all active broker PTY sessions.
 *
 * @returns Array of PTY info objects
 */
export function list(): BrokerPtyInfo[] {
  return Array.from(sessions.values()).map((s) => s.info)
}

/**
 * Kill a broker PTY session.
 *
 * Sends kill request to broker and cleans up local state.
 * Closes all connected WebSocket subscribers.
 *
 * @param id - PTY session ID to kill
 */
export async function kill(id: string, requestId?: string): Promise<void> {
  const session = sessions.get(id)
  if (!session) return

  const brokerClient = new BrokerClient()
  await brokerClient.killPty(session.info.ptyId, requestId)

  session.info.status = "exited"
  sessions.delete(id)

  // Close any subscribers
  for (const ws of session.subscribers) {
    ws.close()
  }

  log.info("Broker PTY killed", {
    ptyId: id,
    sessionId: session.info.sessionId,
    requestId,
    method: "killpty",
  })
}

/**
 * Resize a broker PTY session.
 *
 * Sends resize request to broker which calls TIOCSWINSZ.
 * The running process receives SIGWINCH.
 *
 * @param id - PTY session ID to resize
 * @param cols - New column count
 * @param rows - New row count
 */
export async function resize(id: string, cols: number, rows: number, requestId?: string): Promise<void> {
  const session = sessions.get(id)
  if (!session || session.info.status !== "running") return

  const brokerClient = new BrokerClient()
  await brokerClient.resizePty(session.info.ptyId, cols, rows, requestId)

  log.info("Broker PTY resized", {
    ptyId: id,
    cols,
    rows,
    sessionId: session.info.sessionId,
    requestId,
    method: "resizepty",
  })
}

/**
 * Connect a WebSocket to a broker PTY for I/O.
 *
 * Returns handlers for message and close events.
 * Messages from WebSocket are written to PTY via broker.
 * PTY output is relayed to WebSocket via broker polling (TODO: streaming).
 *
 * @param id - PTY session ID to connect to
 * @param ws - WebSocket context from Hono
 * @returns Event handlers or undefined if PTY not found
 *
 * @example
 * ```typescript
 * const handlers = BrokerPty.connect(ptyId, ws)
 * if (handlers) {
 *   ws.on('message', handlers.onMessage)
 *   ws.on('close', handlers.onClose)
 * }
 * ```
 */
export function connect(
  id: string,
  ws: WSContext,
): { onMessage: (msg: string | ArrayBuffer) => void; onClose: () => void } | undefined {
  const session = sessions.get(id)
  if (!session) {
    ws.close()
    return
  }

  session.subscribers.add(ws)
  log.info("Broker PTY client connected", { ptyId: id, sessionId: session.info.sessionId })

  // Send buffered output
  if (session.buffer) {
    ws.send(session.buffer)
    session.buffer = ""
  }

  return {
    onMessage: async (msg: string | ArrayBuffer) => {
      const brokerClient = new BrokerClient()
      const data = typeof msg === "string" ? msg : new Uint8Array(msg as ArrayBuffer)
      const success = await brokerClient.ptyWrite(session.info.ptyId, data)
      if (!success) {
        log.warn("Failed to write to broker PTY", {
          ptyId: id,
          sessionId: session.info.sessionId,
          method: "ptywrite",
        })
      }
    },
    onClose: () => {
      session.subscribers.delete(ws)
      log.info("Broker PTY client disconnected", { ptyId: id, sessionId: session.info.sessionId })
    },
  }
}

// TODO: Implement PTY output streaming
// Options:
// 1. Polling ptyRead at intervals (simple but inefficient)
// 2. WebSocket from broker -> web server for PTY output (complex)
// 3. Implement FD passing via SCM_RIGHTS (requires native addon)
//
// Current foundation supports polling via ptyRead - streaming is future work.
