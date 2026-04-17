import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect"
import { Instance } from "@/project/instance"
import type { Proc } from "#pty"
import z from "zod"
import { Log } from "../util"
import { lazy } from "@opencode-ai/shared/util/lazy"
import { Shell } from "@/shell/shell"
import { Plugin } from "@/plugin"
import { PtyID } from "./schema"
import { Effect, Layer, Context } from "effect"
import { EffectBridge } from "@/effect"

const log = Log.create({ service: "pty" })

const BUFFER_LIMIT = 1024 * 1024 * 2
const BUFFER_CHUNK = 64 * 1024
const encoder = new TextEncoder()

type Socket = {
  readyState: number
  data?: unknown
  send: (data: string | Uint8Array | ArrayBuffer) => void
  close: (code?: number, reason?: string) => void
}

const sock = (ws: Socket) => (ws.data && typeof ws.data === "object" ? ws.data : ws)

type Active = {
  info: Info
  process: Proc
  buffer: string
  bufferCursor: number
  cursor: number
  subscribers: Map<unknown, Socket>
}

type State = {
  dir: string
  sessions: Map<PtyID, Active>
}

// WebSocket control frame: 0x00 + UTF-8 JSON.
const meta = (cursor: number) => {
  const json = JSON.stringify({ cursor })
  const bytes = encoder.encode(json)
  const out = new Uint8Array(bytes.length + 1)
  out[0] = 0
  out.set(bytes, 1)
  return out
}

const pty = lazy(() => import("#pty"))

export const Info = z
  .object({
    id: PtyID.zod,
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
  Exited: BusEvent.define("pty.exited", z.object({ id: PtyID.zod, exitCode: z.number() })),
  Deleted: BusEvent.define("pty.deleted", z.object({ id: PtyID.zod })),
}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: PtyID) => Effect.Effect<Info | undefined>
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly update: (id: PtyID, input: UpdateInput) => Effect.Effect<Info | undefined>
  readonly remove: (id: PtyID) => Effect.Effect<void>
  readonly resize: (id: PtyID, cols: number, rows: number) => Effect.Effect<void>
  readonly write: (id: PtyID, data: string) => Effect.Effect<void>
  readonly connect: (
    id: PtyID,
    ws: Socket,
    cursor?: number,
  ) => Effect.Effect<{ onMessage: (message: string | ArrayBuffer) => void; onClose: () => void } | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Pty") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const plugin = yield* Plugin.Service
    function teardown(session: Active) {
      try {
        session.process.kill()
      } catch {}
      for (const [sub, ws] of session.subscribers.entries()) {
        try {
          if (sock(ws) === sub) ws.close()
        } catch {}
      }
      session.subscribers.clear()
    }

    const state = yield* InstanceState.make<State>(
      Effect.fn("Pty.state")(function* (ctx) {
        const state = {
          dir: ctx.directory,
          sessions: new Map<PtyID, Active>(),
        }

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            for (const session of state.sessions.values()) {
              teardown(session)
            }
            state.sessions.clear()
          }),
        )

        return state
      }),
    )

    const remove = Effect.fn("Pty.remove")(function* (id: PtyID) {
      const s = yield* InstanceState.get(state)
      const session = s.sessions.get(id)
      if (!session) return
      s.sessions.delete(id)
      log.info("removing session", { id })
      teardown(session)
      yield* bus.publish(Event.Deleted, { id: session.info.id })
    })

    const list = Effect.fn("Pty.list")(function* () {
      const s = yield* InstanceState.get(state)
      return Array.from(s.sessions.values()).map((session) => session.info)
    })

    const get = Effect.fn("Pty.get")(function* (id: PtyID) {
      const s = yield* InstanceState.get(state)
      return s.sessions.get(id)?.info
    })

    const create = Effect.fn("Pty.create")(function* (input: CreateInput) {
      const s = yield* InstanceState.get(state)
      const bridge = yield* EffectBridge.make()
      const id = PtyID.ascending()
      const command = input.command || Shell.preferred()
      const args = input.args || []
      if (Shell.login(command)) {
        args.push("-l")
      }

      const cwd = input.cwd || s.dir
      const shell = yield* plugin.trigger("shell.env", { cwd }, { env: {} })
      const env = {
        ...process.env,
        ...input.env,
        ...shell.env,
        TERM: "xterm-256color",
        OPENCODE_TERMINAL: "1",
      } as Record<string, string>

      if (process.platform === "win32") {
        env.LC_ALL = "C.UTF-8"
        env.LC_CTYPE = "C.UTF-8"
        env.LANG = "C.UTF-8"
      }
      log.info("creating session", { id, cmd: command, args, cwd })

      const { spawn } = yield* Effect.promise(() => pty())
      const proc = yield* Effect.sync(() =>
        spawn(command, args, {
          name: "xterm-256color",
          cwd,
          env,
        }),
      )

      const info = {
        id,
        title: input.title || `Terminal ${id.slice(-4)}`,
        command,
        args,
        cwd,
        status: "running",
        pid: proc.pid,
      } as const
      const session: Active = {
        info,
        process: proc,
        buffer: "",
        bufferCursor: 0,
        cursor: 0,
        subscribers: new Map(),
      }
      s.sessions.set(id, session)
      proc.onData(
        Instance.bind((chunk) => {
          session.cursor += chunk.length

          for (const [key, ws] of session.subscribers.entries()) {
            if (ws.readyState !== 1) {
              session.subscribers.delete(key)
              continue
            }
            if (sock(ws) !== key) {
              session.subscribers.delete(key)
              continue
            }
            try {
              ws.send(chunk)
            } catch {
              session.subscribers.delete(key)
            }
          }

          session.buffer += chunk
          if (session.buffer.length <= BUFFER_LIMIT) return
          const excess = session.buffer.length - BUFFER_LIMIT
          session.buffer = session.buffer.slice(excess)
          session.bufferCursor += excess
        }),
      )
      proc.onExit(
        Instance.bind(({ exitCode }) => {
          if (session.info.status === "exited") return
          log.info("session exited", { id, exitCode })
          session.info.status = "exited"
          bridge.fork(bus.publish(Event.Exited, { id, exitCode }))
          bridge.fork(remove(id))
        }),
      )
      yield* bus.publish(Event.Created, { info })
      return info
    })

    const update = Effect.fn("Pty.update")(function* (id: PtyID, input: UpdateInput) {
      const s = yield* InstanceState.get(state)
      const session = s.sessions.get(id)
      if (!session) return
      if (input.title) {
        session.info.title = input.title
      }
      if (input.size) {
        session.process.resize(input.size.cols, input.size.rows)
      }
      yield* bus.publish(Event.Updated, { info: session.info })
      return session.info
    })

    const resize = Effect.fn("Pty.resize")(function* (id: PtyID, cols: number, rows: number) {
      const s = yield* InstanceState.get(state)
      const session = s.sessions.get(id)
      if (session && session.info.status === "running") {
        session.process.resize(cols, rows)
      }
    })

    const write = Effect.fn("Pty.write")(function* (id: PtyID, data: string) {
      const s = yield* InstanceState.get(state)
      const session = s.sessions.get(id)
      if (session && session.info.status === "running") {
        session.process.write(data)
      }
    })

    const connect = Effect.fn("Pty.connect")(function* (id: PtyID, ws: Socket, cursor?: number) {
      const s = yield* InstanceState.get(state)
      const session = s.sessions.get(id)
      if (!session) {
        ws.close()
        return
      }
      log.info("client connected to session", { id })

      const sub = sock(ws)
      session.subscribers.delete(sub)
      session.subscribers.set(sub, ws)

      const cleanup = () => {
        session.subscribers.delete(sub)
      }

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
          cleanup()
          ws.close()
          return
        }
      }

      try {
        ws.send(meta(end))
      } catch {
        cleanup()
        ws.close()
        return
      }

      return {
        onMessage: (message: string | ArrayBuffer) => {
          session.process.write(typeof message === "string" ? message : new TextDecoder().decode(message))
        },
        onClose: () => {
          log.info("client disconnected from session", { id })
          cleanup()
        },
      }
    })

    return Service.of({ list, get, create, update, remove, resize, write, connect })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(Plugin.defaultLayer))

export * as Pty from "."
