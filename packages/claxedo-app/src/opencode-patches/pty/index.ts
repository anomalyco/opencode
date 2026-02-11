/**
 * PTY Module (Claxedo Patched)
 *
 * This is a patched version of packages/opencode/src/pty/index.ts
 * that adds claxedo-specific features on top of upstream's cursor-based
 * replay system.
 *
 * CHANGES FROM UPSTREAM:
 * - Agent hooks env injection (CLAXEDO_PORT)
 * - OSC-7 CWD tracking
 * - Disk-backed history for persistent replay across restarts
 * - Escape filter for clear-scrollback detection
 * - safeBroadcast/safeReplay (try/catch on ws.send)
 * - killProcessTree (process group cleanup)
 * - cleanupSession (centralized cleanup with guards)
 * - Write queue with ready flag (queue until first client connects)
 * - Event.Stream (lifecycle events for frontend)
 * - CLAXEDO_DEBUG flag
 */

import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { type IPty } from "bun-pty"
import z from "zod"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import type { WSContext } from "hono/ws"
import { Instance } from "@/project/instance"
import { lazy } from "@opencode-ai/util/lazy"
import { Shell } from "@/shell/shell"
import { Plugin } from "@/plugin"
// CLAXEDO PATCH: Agent hooks for CLI agent lifecycle tracking
import { getTerminalEnvVars, isSetupComplete, setupAgentHooks } from "@/agent-hooks"
// CLAXEDO PATCH: Persistent PTY replay history for reconnect/reload continuity
import { createDiskHistory } from "./history-disk"
// CLAXEDO PATCH: Detect clear-scrollback sequences to wipe history
import { containsClearScrollbackSequence, extractContentAfterClear } from "./escape-filter"
// CLAXEDO PATCH: OSC-7 CWD tracking (standalone for testability)
import { osc7 as osc7Parser } from "./osc7"

// CLAXEDO PATCH: Lazy agent hooks setup
const setup = { promise: undefined as Promise<void> | undefined }

async function ensureSetup(port: number) {
  if (isSetupComplete()) return true
  if (!setup.promise) {
    setup.promise = setupAgentHooks({ port })
      .catch(() => undefined)
      .finally(() => {
        setup.promise = undefined
      })
  }
  await setup.promise
  return isSetupComplete()
}

export namespace Pty {
  const log = Log.create({ service: "pty" })

  const BUFFER_LIMIT = 1024 * 1024 * 2
  // CLAXEDO PATCH: Configurable disk history limit (default 16 MiB)
  const HISTORY_LIMIT = (() => {
    const raw = Number(process.env.OPENCODE_PTY_HISTORY_LIMIT)
    if (!Number.isFinite(raw) || raw <= 0) return 1024 * 1024 * 16
    return Math.floor(raw)
  })()
  const BUFFER_CHUNK = 64 * 1024
  // CLAXEDO PATCH: Write queue watermarks
  const QUEUE_HIGH_WATERMARK = (() => {
    const raw = Number(process.env.OPENCODE_PTY_QUEUE_HIGH_WATERMARK)
    if (!Number.isFinite(raw) || raw <= 0) return 1024 * 1024
    return Math.floor(raw)
  })()
  const QUEUE_LOW_WATERMARK = (() => {
    const raw = Number(process.env.OPENCODE_PTY_QUEUE_LOW_WATERMARK)
    if (!Number.isFinite(raw) || raw <= 0) return 256 * 1024
    return Math.floor(raw)
  })()
  const DEBUG = process.env.OPENCODE_PTY_DEBUG === "1"
  const DEBUG_RESIZE = process.env.OPENCODE_DEBUG_PTY_RESIZE === "1"
  // CLAXEDO PATCH: Debug flag for agent hooks integration
  const CLAXEDO_DEBUG = process.env.CLAXEDO_DEBUG === "1"
  const encoder = new TextEncoder()

  // WebSocket control frame: 0x00 + UTF-8 JSON (currently { cursor }).
  const meta = (cursor: number) => {
    const json = JSON.stringify({ cursor })
    const bytes = encoder.encode(json)
    const out = new Uint8Array(bytes.length + 1)
    out[0] = 0
    out.set(bytes, 1)
    return out
  }

  // CLAXEDO PATCH: Re-export osc7 parser from standalone module
  export const osc7 = osc7Parser

  // CLAXEDO PATCH: Write queue types and helpers
  type QueuedOperation = { type: "write"; data: string } | { type: "resize"; cols: number; rows: number }

  const operationBytes = (operation: QueuedOperation) => (operation.type === "write" ? operation.data.length : 0)

  // CLAXEDO PATCH: Safe replay with try/catch
  function safeReplay(ws: WSContext, replay: string) {
    if (!replay) return true
    try {
      for (let i = 0; i < replay.length; i += BUFFER_CHUNK) {
        ws.send(replay.slice(i, i + BUFFER_CHUNK))
      }
      return true
    } catch {
      return false
    }
  }

  // CLAXEDO PATCH: Safe broadcast with try/catch
  function safeBroadcast(session: ActiveSession, data: string) {
    for (const ws of session.subscribers) {
      if (ws.readyState !== 1) {
        session.subscribers.delete(ws)
        continue
      }
      try {
        ws.send(data)
      } catch {
        session.subscribers.delete(ws)
        ws.close()
      }
    }
  }

  // CLAXEDO PATCH: Queue writes until first client connects
  function enqueueWrite(session: ActiveSession, operation: QueuedOperation) {
    if (operation.type === "write" && !operation.data) return
    session.writeQueue.push(operation)
    session.queuedBytes += operationBytes(operation)
    if (session.queuedBytes <= session.highWatermark) return
    while (session.queuedBytes > session.lowWatermark && session.writeQueue.length > 1) {
      const dropped = session.writeQueue.shift()
      if (!dropped) break
      session.queuedBytes -= operationBytes(dropped)
    }
  }

  // CLAXEDO PATCH: Flush queued writes when first client connects
  function flushWriteQueue(session: ActiveSession) {
    if (!session.ready) return
    if (session.info.status !== "running") return
    while (session.writeQueue.length > 0) {
      const next = session.writeQueue.shift()
      if (!next) break
      session.queuedBytes -= operationBytes(next)
      if (next.type === "write") {
        session.process.write(next.data)
        continue
      }
      session.process.resize(next.cols, next.rows)
    }
    if (session.queuedBytes < 0) session.queuedBytes = 0
  }

  // CLAXEDO PATCH: Kill process group for clean cleanup
  async function killProcessTree(pid: number) {
    if (!Number.isFinite(pid) || pid <= 0) return
    if (process.platform !== "win32") {
      try {
        process.kill(-pid, "SIGTERM")
      } catch {}
    }
    try {
      process.kill(pid, "SIGTERM")
    } catch {}
  }

  const pty = lazy(async () => {
    const { spawn } = await import("bun-pty")
    return spawn
  })

  export const Info = z
    .object({
      id: Identifier.schema("pty"),
      title: z.string(),
      command: z.string(),
      args: z.array(z.string()),
      cwd: z.string(),
      status: z.enum(["running", "exited"]),
      pid: z.number(),
    })
    .meta({ ref: "Pty" })

  export type Info = z.infer<typeof Info>

  export const CreateInput = z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    title: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  })

  export type CreateInput = z.infer<typeof CreateInput>

  export const UpdateInput = z.object({
    title: z.string().optional(),
    size: z
      .object({
        rows: z.number(),
        cols: z.number(),
      })
      .optional(),
  })

  export type UpdateInput = z.infer<typeof UpdateInput>

  export const Event = {
    Created: BusEvent.define("pty.created", z.object({ info: Info })),
    Updated: BusEvent.define("pty.updated", z.object({ info: Info })),
    Exited: BusEvent.define("pty.exited", z.object({ id: Identifier.schema("pty"), exitCode: z.number() })),
    Deleted: BusEvent.define("pty.deleted", z.object({ id: Identifier.schema("pty") })),
    // CLAXEDO PATCH: Lifecycle stream events
    Stream: BusEvent.define(
      "pty.stream",
      z.object({
        id: Identifier.schema("pty"),
        kind: z.enum(["exit", "disconnect", "error"]),
        exitCode: z.number().optional(),
        message: z.string().optional(),
      }),
    ),
  }

  interface ActiveSession {
    info: Info
    process: IPty
    // Upstream: cursor-based in-memory buffer for delta replay
    buffer: string
    bufferCursor: number
    cursor: number
    // CLAXEDO PATCH: Disk-backed history for persistent replay
    history: Awaited<ReturnType<typeof createDiskHistory>>
    // CLAXEDO PATCH: OSC-7 CWD tracking buffer
    osc7: string
    subscribers: Set<WSContext>
    // CLAXEDO PATCH: Cleanup guards
    exited: boolean
    removed: boolean
    // CLAXEDO PATCH: Write queue gating
    ready: boolean
    writeQueue: QueuedOperation[]
    queuedBytes: number
    highWatermark: number
    lowWatermark: number
  }

  // CLAXEDO PATCH: Centralized session cleanup with guards
  async function cleanupSession(id: string, session: ActiveSession, reason: "exit" | "remove") {
    if (session.removed) return
    session.removed = true
    session.ready = false
    for (const ws of session.subscribers) {
      ws.close()
    }
    session.subscribers.clear()
    session.writeQueue = []
    session.queuedBytes = 0
    try {
      await killProcessTree(session.info.pid)
    } catch {}
    if (reason === "remove") await session.history.clear()
    if (reason === "exit") await session.history.close()
    state().delete(id)
  }

  const state = Instance.state(
    () => new Map<string, ActiveSession>(),
    async (sessions) => {
      for (const [id, session] of sessions.entries()) {
        await cleanupSession(id, session, "exit")
      }
      sessions.clear()
    },
  )

  export function list() {
    return Array.from(state().values()).map((s) => s.info)
  }

  export function get(id: string) {
    return state().get(id)?.info
  }

  export async function create(input: CreateInput) {
    const id = Identifier.create("pty", false)
    const command = input.command || Shell.preferred()
    const args = input.args || []
    if (command.endsWith("sh")) {
      args.push("-l")
    }

    const cwd = input.cwd || Instance.directory
    const shellEnv = await Plugin.trigger("shell.env", { cwd }, { env: {} })
    const env = {
      ...process.env,
      ...input.env,
      ...shellEnv.env,
      TERM: "xterm-256color",
      OPENCODE_TERMINAL: "1",
    } as Record<string, string>
    if (DEBUG_RESIZE) {
      log.info("pty create env", {
        id,
        cwd,
        shell: command,
        term: env.TERM,
        columns: env.COLUMNS,
        lines: env.LINES,
      })
    }

    // CLAXEDO PATCH: Auto-inject agent hooks environment if CLAXEDO_PORT is set
    const claxedoPort = env.CLAXEDO_PORT
    const port = claxedoPort ? parseInt(claxedoPort, 10) || 7860 : 0

    const setupComplete = claxedoPort ? await ensureSetup(port) : false

    if (CLAXEDO_DEBUG && claxedoPort) {
      log.info("Agent hooks check", {
        CLAXEDO_PORT: claxedoPort,
        isSetupComplete: setupComplete,
        command,
        id,
      })
    }

    if (claxedoPort && setupComplete) {
      const tabId = env.CLAXEDO_TAB_ID || id
      const terminalId = env.CLAXEDO_TERMINAL_ID || id
      const workspaceId = env.CLAXEDO_WORKSPACE_ID || cwd

      if (CLAXEDO_DEBUG) {
        log.info("Injecting agent hooks env", { tabId, terminalId, workspaceId, port })
      }

      const agentEnv = getTerminalEnvVars({
        tabId,
        terminalId,
        workspaceId,
        port,
        shell: command,
      })

      if (CLAXEDO_DEBUG) {
        log.info("Agent hooks env vars", agentEnv)
      }

      Object.assign(env, agentEnv)
    } else if (CLAXEDO_DEBUG && claxedoPort && !setupComplete) {
      log.warn("Agent hooks not injected: setup incomplete", {
        CLAXEDO_PORT: claxedoPort,
      })
    }

    if (process.platform === "win32") {
      env.LC_ALL = "C.UTF-8"
      env.LC_CTYPE = "C.UTF-8"
      env.LANG = "C.UTF-8"
    }
    log.info("creating session", { id, cmd: command, args, cwd })
    if (DEBUG) log.info("create input", input)

    const spawn = await pty()
    const ptyProcess = spawn(command, args, {
      name: "xterm-256color",
      cwd,
      env,
    })

    const info = {
      id,
      title: input.title || `Terminal ${id.slice(-4)}`,
      command,
      args,
      cwd,
      status: "running",
      pid: ptyProcess.pid,
    } as const
    const history = await createDiskHistory({ directory: cwd, id, limit: HISTORY_LIMIT })

    const session: ActiveSession = {
      info,
      process: ptyProcess,
      buffer: "",
      bufferCursor: 0,
      cursor: 0,
      history,
      osc7: "",
      subscribers: new Set(),
      exited: false,
      removed: false,
      ready: false,
      writeQueue: [],
      queuedBytes: 0,
      highWatermark: QUEUE_HIGH_WATERMARK,
      lowWatermark: QUEUE_LOW_WATERMARK,
    }
    state().set(id, session)
    ptyProcess.onData((data) => {
      // Upstream: track cursor position
      session.cursor += data.length

      // CLAXEDO PATCH: OSC-7 CWD tracking
      const parsed = osc7(session.osc7, data)
      session.osc7 = parsed.buf
      if (parsed.cwd && parsed.cwd !== session.info.cwd) {
        session.info.cwd = parsed.cwd
        if (DEBUG) log.info("cwd updated", { id, cwd: parsed.cwd })
        Bus.publish(Event.Updated, { info: session.info })
      }

      // CLAXEDO PATCH: safeBroadcast instead of raw broadcast
      safeBroadcast(session, data)

      // Upstream: always accumulate buffer for cursor-based replay
      session.buffer += data
      if (session.buffer.length > BUFFER_LIMIT) {
        const excess = session.buffer.length - BUFFER_LIMIT
        session.buffer = session.buffer.slice(excess)
        session.bufferCursor += excess
      }

      // CLAXEDO PATCH: Disk history with escape filter
      const filtered = (() => {
        if (!containsClearScrollbackSequence(data)) return data
        void session.history.clear()
        return extractContentAfterClear(data)
      })()
      if (filtered) session.history.append(filtered)
    })
    ptyProcess.onExit(async ({ exitCode }) => {
      // CLAXEDO PATCH: Guard against double exit
      if (session.exited) return
      session.exited = true
      log.info("session exited", { id, exitCode })
      session.info.status = "exited"
      Bus.publish(Event.Exited, { id, exitCode })
      Bus.publish(Event.Stream, { id, kind: "exit", exitCode })
      await cleanupSession(id, session, "exit")
    })
    Bus.publish(Event.Created, { info })
    return info
  }

  export async function update(id: string, input: UpdateInput) {
    const session = state().get(id)
    if (!session) return
    if (input.title) {
      session.info.title = input.title
    }
    if (input.size) {
      if (DEBUG_RESIZE) {
        log.info("pty.update size", {
          id,
          cols: input.size.cols,
          rows: input.size.rows,
          ready: session.ready,
          subscribers: session.subscribers.size,
          queueDepth: session.writeQueue.length,
        })
      }
      // CLAXEDO PATCH: Queue resize if not ready
      if (!session.ready) {
        enqueueWrite(session, { type: "resize", cols: input.size.cols, rows: input.size.rows })
      } else {
        session.process.resize(input.size.cols, input.size.rows)
      }
    }
    Bus.publish(Event.Updated, { info: session.info })
    return session.info
  }

  export async function remove(id: string) {
    const session = state().get(id)
    if (!session) return
    log.info("removing session", { id })
    await cleanupSession(id, session, "remove")
    Bus.publish(Event.Deleted, { id })
  }

  export function resize(id: string, cols: number, rows: number) {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      // CLAXEDO PATCH: Queue resize if not ready
      if (!session.ready) {
        enqueueWrite(session, { type: "resize", cols, rows })
        return
      }
      session.process.resize(cols, rows)
    }
  }

  export function write(id: string, data: string) {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      // CLAXEDO PATCH: Queue write if not ready
      if (!session.ready) {
        enqueueWrite(session, { type: "write", data })
        return
      }
      session.process.write(data)
    }
  }

  export function connect(id: string, ws: WSContext, cursor?: number) {
    const session = state().get(id)
    if (!session) {
      ws.close()
      return
    }
    log.info("client connected to session", { id })
    session.subscribers.add(ws)

    // Upstream: cursor-based delta replay from in-memory buffer
    const start = session.bufferCursor
    const end = session.cursor

    const from =
      cursor === -1 ? end : typeof cursor === "number" && Number.isSafeInteger(cursor) ? Math.max(0, cursor) : 0
    if (DEBUG_RESIZE) {
      log.info("pty.connect cursor", {
        id,
        start,
        end,
        requested: cursor,
        from,
      })
    }

    const data = (() => {
      if (!session.buffer) return ""
      if (from >= end) return ""
      const offset = Math.max(0, from - start)
      if (offset >= session.buffer.length) return ""
      return session.buffer.slice(offset)
    })()

    if (!safeReplay(ws, data)) {
      session.subscribers.delete(ws)
      Bus.publish(Event.Stream, { id, kind: "error", message: "replay_send_failed" })
      ws.close()
      return
    }

    // Upstream: send cursor meta frame
    try {
      ws.send(meta(end))
    } catch {
      session.subscribers.delete(ws)
      ws.close()
      return
    }

    // CLAXEDO PATCH: Mark ready and flush queued writes
    session.ready = true
    flushWriteQueue(session)

    return {
      onMessage: (message: string | ArrayBuffer) => {
        write(id, String(message))
      },
      onClose: () => {
        log.info("client disconnected from session", { id })
        session.subscribers.delete(ws)
        Bus.publish(Event.Stream, { id, kind: "disconnect" })
        // CLAXEDO PATCH: Reset ready flag when all clients disconnect
        if (session.subscribers.size === 0) {
          session.ready = false
        }
      },
    }
  }
}
