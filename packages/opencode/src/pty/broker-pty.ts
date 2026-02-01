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
const BUFFER_CHUNK = 64 * 1024
const POLL_INTERVAL_MS = 200
const decoder = new TextDecoder()

export class BrokerSessionNotFoundError extends Error {
  code = "broker_session_not_found"
}

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
  /** Polling timer for broker output */
  poller?: ReturnType<typeof setInterval>
  /** Avoid overlapping read loops */
  reading?: boolean
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
    const message = result.error ?? "Failed to spawn PTY via broker"
    if (message.toLowerCase().includes("session not found")) {
      throw new BrokerSessionNotFoundError(message)
    }
    throw new Error(message)
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
  startPolling(session)

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
  stopPolling(session)
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
  options: { requestId?: string } = {},
): { onMessage: (msg: string | ArrayBuffer) => void; onClose: () => void } | undefined {
  const session = sessions.get(id)
  if (!session) {
    ws.close()
    return
  }

  session.subscribers.add(ws)
  log.info("Broker PTY client connected", { ptyId: id, sessionId: session.info.sessionId, requestId: options.requestId })
  startPolling(session)

  // Send buffered output
  if (session.buffer) {
    try {
      for (let i = 0; i < session.buffer.length; i += BUFFER_CHUNK) {
        ws.send(session.buffer.slice(i, i + BUFFER_CHUNK))
      }
      session.buffer = ""
    } catch {
      session.subscribers.delete(ws)
    }
  }

  return {
    onMessage: async (msg: string | ArrayBuffer) => {
      const brokerClient = new BrokerClient()
      const data = typeof msg === "string" ? msg : new Uint8Array(msg as ArrayBuffer)
      const success = await brokerClient.ptyWrite(session.info.ptyId, data, options.requestId)
      if (!success) {
        log.warn("Failed to write to broker PTY", {
          ptyId: id,
          sessionId: session.info.sessionId,
          requestId: options.requestId,
          method: "ptywrite",
        })
      }
    },
    onClose: () => {
      session.subscribers.delete(ws)
      log.info("Broker PTY client disconnected", { ptyId: id, sessionId: session.info.sessionId, requestId: options.requestId })
    },
  }
}

function startPolling(session: BrokerPtySession): void {
  if (session.poller) return
  session.poller = setInterval(() => {
    void pollOutput(session)
  }, POLL_INTERVAL_MS)
}

function stopPolling(session: BrokerPtySession): void {
  if (!session.poller) return
  clearInterval(session.poller)
  session.poller = undefined
}

async function pollOutput(session: BrokerPtySession): Promise<void> {
  if (session.reading) return
  session.reading = true
  try {
    const brokerClient = new BrokerClient()
    let iterations = 0
    let more = true
    while (more && iterations < 4) {
      const result = await brokerClient.ptyRead(session.info.ptyId, 4096)
      if (!result || result.data.length === 0) {
        break
      }
      const text = decoder.decode(result.data)
      if (session.subscribers.size > 0) {
        for (const ws of session.subscribers) {
          if (ws.readyState !== 1) {
            session.subscribers.delete(ws)
            continue
          }
          try {
            ws.send(text)
          } catch {
            session.subscribers.delete(ws)
          }
        }
      } else {
        session.buffer += text
        if (session.buffer.length > BUFFER_LIMIT) {
          session.buffer = session.buffer.slice(-BUFFER_LIMIT)
        }
      }
      more = result.more
      iterations += 1
    }
  } catch (error) {
    log.warn("Broker PTY poll failed", { ptyId: session.info.ptyId, error })
  } finally {
    session.reading = false
  }
}

// TODO: Implement PTY output streaming
// Options:
// 1. Polling ptyRead at intervals (simple but inefficient)
// 2. WebSocket from broker -> web server for PTY output (complex)
// 3. Implement FD passing via SCM_RIGHTS (requires native addon)
//
// Current foundation supports polling via ptyRead - streaming is future work.
