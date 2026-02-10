import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { type IPty } from "bun-pty"
import z from "zod"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import type { WSContext } from "hono/ws"
import { Instance } from "../project/instance"
import { lazy } from "@opencode-ai/util/lazy"
import { Shell } from "@/shell/shell"
import { Plugin } from "@/plugin"
import { createDiskHistory } from "./history-disk"
import { containsClearScrollbackSequence, extractContentAfterClear } from "./escape-filter"

export namespace Pty {
  const log = Log.create({ service: "pty" })

  const BUFFER_LIMIT = 1024 * 1024 * 2
  const HISTORY_LIMIT = (() => {
    const raw = Number(process.env.OPENCODE_PTY_HISTORY_LIMIT)
    if (!Number.isFinite(raw) || raw <= 0) return 1024 * 1024 * 16
    return Math.floor(raw)
  })()
  const BUFFER_CHUNK = 64 * 1024
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

  export const osc7 = (buf: string, chunk: string) => {
    // OSC-7: ESC ] 7 ; file://hostname/path BEL  (or ST = ESC \\)
    const esc = "\x1b"
    const bel = "\x07"
    const prefix = `${esc}]7;file://`
    const max = 1024

    const data = buf + chunk

    let pos = 0
    let cwd: string | undefined
    for (;;) {
      const start = data.indexOf(prefix, pos)
      if (start === -1) break

      const from = start + prefix.length
      const belEnd = data.indexOf(bel, from)
      const st = `${esc}\\`
      const stEnd = data.indexOf(st, from)

      const end = (() => {
        if (belEnd === -1) return stEnd
        if (stEnd === -1) return belEnd
        return Math.min(belEnd, stEnd)
      })()

      if (end === -1) {
        const tail = data.slice(start)
        return {
          cwd,
          buf: tail.length <= max ? tail : "",
        }
      }

      const body = data.slice(from, end)
      const slash = body.indexOf("/")
      if (slash !== -1) {
        const raw = body.slice(slash)
        cwd = (() => {
          if (!raw.includes("%")) return raw
          try {
            return decodeURIComponent(raw)
          } catch {
            return raw
          }
        })()
      }

      pos = end + (end === stEnd ? st.length : 1)
    }

    const last = data.lastIndexOf(esc)
    if (last === -1) return { cwd, buf: "" }

    const tail = data.slice(last)
    if (!prefix.startsWith(tail)) return { cwd, buf: "" }
    return { cwd, buf: tail.length <= max ? tail : "" }
  }

  type QueuedOperation = { type: "write"; data: string } | { type: "resize"; cols: number; rows: number }

  const operationBytes = (operation: QueuedOperation) => (operation.type === "write" ? operation.data.length : 0)

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

  function safeBroadcast(session: ActiveSession, data: string) {
    let sent = false
    for (const ws of session.subscribers) {
      if (ws.readyState !== 1) {
        session.subscribers.delete(ws)
        continue
      }
      try {
        ws.send(data)
        sent = true
      } catch {
        session.subscribers.delete(ws)
        ws.close()
      }
    }
    return sent
  }

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
    history: Awaited<ReturnType<typeof createDiskHistory>>
    osc7: string
    subscribers: Set<WSContext>
    exited: boolean
    removed: boolean
    ready: boolean
    writeQueue: QueuedOperation[]
    queuedBytes: number
    highWatermark: number
    lowWatermark: number
  }

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
      const parsed = osc7(session.osc7, data)
      session.osc7 = parsed.buf
      if (parsed.cwd && parsed.cwd !== session.info.cwd) {
        session.info.cwd = parsed.cwd
        if (DEBUG) log.info("cwd updated", { id, cwd: parsed.cwd })
        Bus.publish(Event.Updated, { info: session.info })
      }

      safeBroadcast(session, data)
      const filtered = (() => {
        if (!containsClearScrollbackSequence(data)) return data
        void session.history.clear()
        return extractContentAfterClear(data)
      })()
      if (filtered) session.history.append(filtered)
    })
    ptyProcess.onExit(async ({ exitCode }) => {
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
      if (!session.ready) {
        enqueueWrite(session, { type: "write", data })
        return
      }
      session.process.write(data)
    }
  }

  export function connect(id: string, ws: WSContext) {
    const session = state().get(id)
    if (!session) {
      ws.close()
      return
    }
    log.info("client connected to session", { id })
    session.subscribers.add(ws)
    const replay = session.history.snapshot(BUFFER_LIMIT)
    if (!safeReplay(ws, replay)) {
      session.subscribers.delete(ws)
      Bus.publish(Event.Stream, { id, kind: "error", message: "replay_send_failed" })
      ws.close()
      return
    }
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
        if (session.subscribers.size === 0) {
          session.ready = false
        }
      },
    }
  }
}
