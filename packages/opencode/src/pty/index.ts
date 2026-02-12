import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { type IPty } from "bun-pty"
import z from "zod"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@opencode-ai/util/lazy"
import { Shell } from "@/shell/shell"
import { Plugin } from "@/plugin"

export namespace Pty {
  const log = Log.create({ service: "pty" })

  const BUFFER_LIMIT = 1024 * 1024 * 2
  const BUFFER_CHUNK = 64 * 1024
  const encoder = new TextEncoder()

  type Socket = {
    readyState: number
    send: (data: string | Uint8Array<ArrayBuffer> | ArrayBuffer) => void
    close: (code?: number, reason?: string) => void
  }

  const sockets = new WeakMap<object, number>()
  let socketCounter = 0

  const tagSocket = (ws: Socket) => {
    if (!ws || typeof ws !== "object") return
    const next = (socketCounter = (socketCounter + 1) % Number.MAX_SAFE_INTEGER)
    sockets.set(ws, next)
    return next
  }

  // WebSocket control frame: 0x00 + UTF-8 JSON (currently { cursor }).
  const meta = (cursor: number) => {
    const json = JSON.stringify({ cursor })
    const bytes = encoder.encode(json)
    const out = new Uint8Array(bytes.length + 1)
    out[0] = 0
    out.set(bytes, 1)
    return out
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
  }

  interface ActiveSession {
    info: Info
    process: IPty
    buffer: string
    bufferCursor: number
    cursor: number
    subscribers: Map<Socket, number>
  }

  const state = Instance.state(
    () => new Map<string, ActiveSession>(),
    async (sessions) => {
      for (const session of sessions.values()) {
        try {
          session.process.kill()
        } catch {}
        for (const ws of session.subscribers.keys()) {
          try {
            ws.close()
          } catch {
            // ignore
          }
        }
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
    const session: ActiveSession = {
      info,
      process: ptyProcess,
      buffer: "",
      bufferCursor: 0,
      cursor: 0,
      subscribers: new Map(),
    }
    state().set(id, session)
    ptyProcess.onData((data) => {
      session.cursor += data.length

      for (const [ws, id] of session.subscribers) {
        if (ws.readyState !== 1) {
          session.subscribers.delete(ws)
          continue
        }
        if (typeof ws === "object" && sockets.get(ws) !== id) {
          session.subscribers.delete(ws)
          continue
        }
        try {
          ws.send(data)
        } catch {
          session.subscribers.delete(ws)
        }
      }

      session.buffer += data
      if (session.buffer.length <= BUFFER_LIMIT) return
      const excess = session.buffer.length - BUFFER_LIMIT
      session.buffer = session.buffer.slice(excess)
      session.bufferCursor += excess
    })
    ptyProcess.onExit(({ exitCode }) => {
      log.info("session exited", { id, exitCode })
      session.info.status = "exited"
      for (const ws of session.subscribers.keys()) {
        try {
          ws.close()
        } catch {
          // ignore
        }
      }
      session.subscribers.clear()
      Bus.publish(Event.Exited, { id, exitCode })
      state().delete(id)
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
      session.process.resize(input.size.cols, input.size.rows)
    }
    Bus.publish(Event.Updated, { info: session.info })
    return session.info
  }

  export async function remove(id: string) {
    const session = state().get(id)
    if (!session) return
    log.info("removing session", { id })
    try {
      session.process.kill()
    } catch {}
    for (const ws of session.subscribers.keys()) {
      try {
        ws.close()
      } catch {
        // ignore
      }
    }
    session.subscribers.clear()
    state().delete(id)
    Bus.publish(Event.Deleted, { id })
  }

  export function resize(id: string, cols: number, rows: number) {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      session.process.resize(cols, rows)
    }
  }

  export function write(id: string, data: string) {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      session.process.write(data)
    }
  }

  export function connect(id: string, ws: Socket, cursor?: number) {
    const session = state().get(id)
    if (!session) {
      ws.close()
      return
    }
    log.info("client connected to session", { id })

    const start = session.bufferCursor
    const end = session.cursor

    const from =
      cursor === -1 ? end : typeof cursor === "number" && Number.isSafeInteger(cursor) ? Math.max(0, cursor) : 0

    const data = (() => {
      if (!session.buffer) return ""
      if (from >= end) return ""
      const offset = Math.max(0, from - start)
      if (offset >= session.buffer.length) return ""
      return session.buffer.slice(offset)
    })()

    if (data) {
      try {
        for (let i = 0; i < data.length; i += BUFFER_CHUNK) {
          ws.send(data.slice(i, i + BUFFER_CHUNK))
        }
      } catch {
        ws.close()
        return
      }
    }

    try {
      ws.send(meta(end))
    } catch {
      ws.close()
      return
    }

    const socketId = tagSocket(ws)
    if (typeof socketId === "number") session.subscribers.set(ws, socketId)
    return {
      onMessage: (message: string | ArrayBuffer) => {
        session.process.write(String(message))
      },
      onClose: () => {
        log.info("client disconnected from session", { id })
        session.subscribers.delete(ws)
      },
    }
  }
}
