import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Instance } from "@/project/instance"
import { type IPty } from "bun-pty"
import z from "zod"
import { Log } from "../util/log"
import { lazy } from "@opencode-ai/util/lazy"
import { Shell } from "@/shell/shell"
import { Plugin } from "@/plugin"
import { PtyID } from "./schema"
import { Effect, Layer, ServiceMap } from "effect"

export namespace Pty {
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

  type Active = {
    info: Info
    process: IPty
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

  const pty = lazy(async () => {
    const { spawn } = await import("bun-pty")
    return spawn
  })

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

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Pty") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      function teardown(session: Active) {
        try {
          session.process.kill()
        } catch {}
        for (const [key, ws] of session.subscribers.entries()) {
          try {
            if (ws.data === key) ws.close()
          } catch {}
        }
        session.subscribers.clear()
      }

      const cache = yield* InstanceState.make<State>(
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
        const state = yield* InstanceState.get(cache)
        const session = state.sessions.get(id)
        if (!session) return
        state.sessions.delete(id)
        log.info("removing session", { id })
        teardown(session)
        void Bus.publish(Event.Deleted, { id: session.info.id })
      })

      const list = Effect.fn("Pty.list")(function* () {
        const state = yield* InstanceState.get(cache)
        return Array.from(state.sessions.values()).map((session) => session.info)
      })

      const get = Effect.fn("Pty.get")(function* (id: PtyID) {
        const state = yield* InstanceState.get(cache)
        return state.sessions.get(id)?.info
      })

      const create = Effect.fn("Pty.create")(function* (input: CreateInput) {
        const state = yield* InstanceState.get(cache)
        return yield* Effect.promise(async () => {
          const id = PtyID.ascending()
          const command = input.command || Shell.preferred()
          const args = input.args || []
          if (command.endsWith("sh")) {
            args.push("-l")
          }

          const cwd = input.cwd || state.dir
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
          const proc = spawn(command, args, {
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
          state.sessions.set(id, session)
          proc.onData(
            Instance.bind((chunk) => {
              session.cursor += chunk.length

              for (const [key, ws] of session.subscribers.entries()) {
                if (ws.readyState !== 1) {
                  session.subscribers.delete(key)
                  continue
                }
                if (ws.data !== key) {
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
              void Bus.publish(Event.Exited, { id, exitCode })
              Effect.runFork(remove(id))
            }),
          )
          await Bus.publish(Event.Created, { info })
          return info
        })
      })

      const update = Effect.fn("Pty.update")(function* (id: PtyID, input: UpdateInput) {
        const state = yield* InstanceState.get(cache)
        const session = state.sessions.get(id)
        if (!session) return
        if (input.title) {
          session.info.title = input.title
        }
        if (input.size) {
          session.process.resize(input.size.cols, input.size.rows)
        }
        void Bus.publish(Event.Updated, { info: session.info })
        return session.info
      })

      const resize = Effect.fn("Pty.resize")(function* (id: PtyID, cols: number, rows: number) {
        const state = yield* InstanceState.get(cache)
        const session = state.sessions.get(id)
        if (session && session.info.status === "running") {
          session.process.resize(cols, rows)
        }
      })

      const write = Effect.fn("Pty.write")(function* (id: PtyID, data: string) {
        const state = yield* InstanceState.get(cache)
        const session = state.sessions.get(id)
        if (session && session.info.status === "running") {
          session.process.write(data)
        }
      })

      const connect = Effect.fn("Pty.connect")(function* (id: PtyID, ws: Socket, cursor?: number) {
        const state = yield* InstanceState.get(cache)
        const session = state.sessions.get(id)
        if (!session) {
          ws.close()
          return
        }
        log.info("client connected to session", { id })

        // Use ws.data as the unique key for this connection lifecycle.
        // If ws.data is undefined, fallback to ws object.
        const key = ws.data && typeof ws.data === "object" ? ws.data : ws
        // Optionally cleanup if the key somehow exists
        session.subscribers.delete(key)
        session.subscribers.set(key, ws)

        const cleanup = () => {
          session.subscribers.delete(key)
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
            session.process.write(String(message))
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

  const { runPromise } = makeRuntime(Service, layer)

  export async function list() {
    return runPromise((svc) => svc.list())
  }

  export async function get(id: PtyID) {
    return runPromise((svc) => svc.get(id))
  }

  export async function resize(id: PtyID, cols: number, rows: number) {
    return runPromise((svc) => svc.resize(id, cols, rows))
  }

  export async function write(id: PtyID, data: string) {
    return runPromise((svc) => svc.write(id, data))
  }

  export async function connect(id: PtyID, ws: Socket, cursor?: number) {
    return runPromise((svc) => svc.connect(id, ws, cursor))
  }

  export async function create(input: CreateInput) {
    return runPromise((svc) => svc.create(input))
  }

  export async function update(id: PtyID, input: UpdateInput) {
    return runPromise((svc) => svc.update(id, input))
  }

  export async function remove(id: PtyID) {
    return runPromise((svc) => svc.remove(id))
  }
}
