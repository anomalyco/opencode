export * as Pty from "./pty.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import type { Disp, Proc } from "#pty"
import { Cause, Context, Duration, Effect, Fiber, Layer, Schema, Types } from "effect"
import { Pty } from "@opencode/schema/pty"
import { Bus } from "./bus.js"
import { Location } from "./location.js"
import { ShellSelect } from "./shell/select.js"
import { ErrorSummary } from "./util/error-summary.js"
import { lazy } from "./util/lazy.js"

const BUFFER_LIMIT = 1024 * 1024 * 2
// Exited sessions stay observable (status, exit code, retained output) until removed explicitly.
// Cap retention so abandoned terminals do not accumulate unbounded buffers.
const EXITED_LIMIT = 25
const DEFAULT_TIMEOUT: Duration.Input = "60 seconds"
const pty = lazy(() => import("#pty"))

export interface Options {
  readonly timeout?: Duration.Input
}

const decodeTimeout = (input?: Duration.Input): Duration.Duration => {
  if (input === undefined) return Duration.fromInputUnsafe(DEFAULT_TIMEOUT)
  try {
    return Duration.fromInputUnsafe(input)
  } catch {
    return Duration.fromInputUnsafe(DEFAULT_TIMEOUT)
  }
}

type Subscriber = {
  readonly onData: (chunk: string) => void
  readonly onEnd: (event: { exitCode?: number }) => void
  active: boolean
  detached: boolean
  pending: string[]
  end?: { exitCode?: number }
}

type Active = {
  info: Info
  process: Proc
  // Retained output ending at cursor.
  buffer: string
  cursor: number
  subscribers: Map<object, Subscriber>
  listeners: Disp[]
  reaperFiber?: Fiber.Fiber<void, unknown>
}

export const ID = Pty.ID
export type ID = Pty.ID

export const Info = Pty.Info
export type Info = Types.DeepMutable<typeof Info.Type>

export const CreateInput = Pty.CreateInput

export type CreateInput = typeof CreateInput.Type

export const UpdateInput = Pty.UpdateInput

export type UpdateInput = typeof UpdateInput.Type

export { Event } from "@opencode/schema/pty"

export type AttachInput = {
  // Absolute output cursor to replay from. -1 tails from the current end; omitted replays the full retained buffer.
  readonly cursor?: number
  // Callbacks fire synchronously from the native PTY data path; keep them non-blocking.
  readonly onData: (chunk: string) => void
  // Fired once when the session stops producing output: process exit (exitCode set), removal, or service teardown.
  readonly onEnd: (event: { exitCode?: number }) => void
}

export type Attachment = {
  // Retained output from the requested cursor to the current end.
  readonly replay: string
  // Absolute output cursor after replay.
  readonly cursor: number
  readonly write: (data: string) => void
  // Starts live delivery after the caller has applied replay and cursor metadata.
  readonly activate: () => void
  readonly detach: () => void
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Pty.NotFoundError", {
  ptyID: ID,
}) {}

export class ExitedError extends Schema.TaggedError<ExitedError>()("Pty.ExitedError", {
  ptyID: ID,
}) {}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly update: (id: ID, input: UpdateInput) => Effect.Effect<Info, NotFoundError>
  readonly remove: (id: ID) => Effect.Effect<void, NotFoundError>
  readonly write: (id: ID, data: string) => Effect.Effect<void, NotFoundError>
  readonly attach: (id: ID, input: AttachInput) => Effect.Effect<Attachment, NotFoundError | ExitedError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Pty") {}

const makeLayer = (options: Options = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const timeout = decodeTimeout(options.timeout)
      const bus = yield* Bus.Service
      const location = yield* Location.Service
      const shell = yield* ShellSelect.Service
      const context = yield* Effect.context()
      const runFork = Effect.runForkWith(context)
      const sessions = new Map<ID, Active>()
      const exitOrder: ID[] = []

      function cancelReaper(session: Active) {
        if (session.reaperFiber) {
          runFork(Fiber.interrupt(session.reaperFiber))
          session.reaperFiber = undefined
        }
      }

      function scheduleReaper(session: Active) {
        if (session.reaperFiber || session.info.status !== "running" || session.subscribers.size > 0) return
        session.reaperFiber = runFork(
          Effect.sleep(timeout).pipe(
            Effect.andThen(
              Effect.gen(function* () {
                const current = sessions.get(session.info.id)
                if (!current || current.subscribers.size > 0 || current.info.status !== "running") return
                session.reaperFiber = undefined
                yield* Effect.logWarning("reaping idle pty session", { id: session.info.id })
                yield* removeSession(session.info.id)
              }),
            ),
            Effect.catchCause((cause: Cause.Cause<unknown>) => {
              if (Cause.hasInterruptsOnly(cause)) return Effect.void
              return Effect.logError("pty reaper failed", {
                id: session.info.id,
                errors: ErrorSummary.from(Cause.squash(cause)),
              })
            }),
          ),
        )
      }

      function notifyEnd(session: Active, event: { exitCode?: number }) {
        for (const subscriber of session.subscribers.values()) {
          if (!subscriber.active) {
            subscriber.end = event
            continue
          }
          try {
            subscriber.onEnd(event)
          } catch {}
        }
        session.subscribers.clear()
      }

      function teardown(session: Active) {
        cancelReaper(session)
        for (const listener of session.listeners) listener.dispose()
        session.listeners.length = 0
        if (session.info.status === "running") {
          try {
            session.process.kill()
          } catch {}
        }
        notifyEnd(session, {})
      }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const session of sessions.values()) teardown(session)
        sessions.clear()
        exitOrder.length = 0
      }),
    )

    const requireSession = Effect.fn("Pty.requireSession")(function* (id: ID) {
      const session = sessions.get(id)
      if (!session) return yield* new NotFoundError({ ptyID: id })
      return session
    })

    const removeSession = Effect.fnUntraced(function* (id: ID) {
      const session = sessions.get(id)
      if (!session) return
      sessions.delete(id)
      const index = exitOrder.indexOf(id)
      if (index !== -1) exitOrder.splice(index, 1)
      yield* Effect.logInfo("removing session", { id })
      teardown(session)
      yield* bus.publish(Pty.Event.Deleted, { id: session.info.id })
    })

    const remove = Effect.fn("Pty.remove")(function* (id: ID) {
      yield* requireSession(id)
      yield* removeSession(id)
    })

    const list = Effect.fn("Pty.list")(function* () {
      return Array.from(sessions.values()).map((session) => session.info)
    })

    const get = Effect.fn("Pty.get")(function* (id: ID) {
      return (yield* requireSession(id)).info
    })

    const create = Effect.fn("Pty.create")(function* (input: CreateInput) {
      const id = ID.ascending()
      const command = input.command || (yield* shell.resolve({ priority: "config" }))
      const args = ShellSelect.login(command) ? [...(input.args ?? []), "-l"] : [...(input.args ?? [])]
      const cwd = input.cwd || location.directory
      const env = {
        ...process.env,
        ...input.env,
        TERM: "xterm-256color",
        OPENCODE_TERMINAL: "1",
      } as Record<string, string>
      if (process.platform === "win32") {
        env.LC_ALL = "C.UTF-8"
        env.LC_CTYPE = "C.UTF-8"
        env.LANG = "C.UTF-8"
      }
      yield* Effect.logInfo("creating session", { id, cmd: command, args, cwd })
      const { spawn } = yield* Effect.promise(() => pty())
      const proc = yield* Effect.sync(() => spawn(command, args, { name: "xterm-256color", cwd, env }))
      const info: Info = {
        id,
        title: input.title || `Terminal ${id.slice(-4)}`,
        command,
        args,
        cwd,
        status: "running",
        pid: proc.pid,
      }
      const session: Active = {
        info,
        process: proc,
        buffer: "",
        cursor: 0,
        subscribers: new Map(),
        listeners: [],
      }
      sessions.set(id, session)
      scheduleReaper(session)
      session.listeners.push(
        proc.onData((chunk) => {
          session.cursor += chunk.length
          for (const [token, subscriber] of session.subscribers.entries()) {
            if (!subscriber.active) {
              subscriber.pending.push(chunk)
              continue
            }
            try {
              subscriber.onData(chunk)
            } catch {
              session.subscribers.delete(token)
              if (session.subscribers.size === 0) scheduleReaper(session)
            }
          }
          session.buffer += chunk
          if (session.buffer.length <= BUFFER_LIMIT) return
          session.buffer = session.buffer.slice(session.buffer.length - BUFFER_LIMIT)
        }),
        proc.onExit(({ exitCode }) => {
          if (session.info.status === "exited") return
          session.info.status = "exited"
          session.info.exitCode = exitCode
          cancelReaper(session)
          notifyEnd(session, { exitCode })
          exitOrder.push(id)
          runFork(
            Effect.gen(function* () {
              yield* Effect.logInfo("session exited", { id, exitCode })
              yield* bus.publish(Pty.Event.Exited, { id, exitCode })
              while (exitOrder.length > EXITED_LIMIT) {
                const oldest = exitOrder[0]
                if (!oldest) break
                yield* removeSession(oldest)
              }
            }),
          )
        }),
      )
      yield* bus.publish(Pty.Event.Created, { info })
      return info
    })

    const update = Effect.fn("Pty.update")(function* (id: ID, input: UpdateInput) {
      const session = yield* requireSession(id)
      if (input.title) session.info.title = input.title
      if (input.size && session.info.status === "running") session.process.resize(input.size.cols, input.size.rows)
      yield* bus.publish(Pty.Event.Updated, { info: session.info })
      return session.info
    })

    const write = Effect.fn("Pty.write")(function* (id: ID, data: string) {
      const session = yield* requireSession(id)
      if (session.info.status === "running") session.process.write(data)
    })

    const attach = Effect.fn("Pty.attach")(function* (id: ID, input: AttachInput) {
      const session = yield* requireSession(id)
      if (session.info.status !== "running") return yield* new ExitedError({ ptyID: id })
      cancelReaper(session)
      yield* Effect.logInfo("client attached to session", { id, directory: location.directory })
      const token = {}
      const subscriber: Subscriber = {
        onData: input.onData,
        onEnd: input.onEnd,
        active: false,
        detached: false,
        pending: [],
      }
      session.subscribers.set(token, subscriber)
      const end = session.cursor
      const from =
        input.cursor === -1
          ? end
          : input.cursor !== undefined && Number.isSafeInteger(input.cursor)
            ? Math.max(0, input.cursor)
            : 0
      return {
        replay: session.buffer.slice(Math.max(0, from - (end - session.buffer.length))),
        cursor: end,
        write: (data: string) => {
          if (session.info.status === "running") session.process.write(data)
        },
        activate: () => {
          if (subscriber.active || subscriber.detached) return
          subscriber.active = true
          try {
            for (const chunk of subscriber.pending) subscriber.onData(chunk)
            subscriber.pending.length = 0
            if (subscriber.end) subscriber.onEnd(subscriber.end)
          } catch {
            session.subscribers.delete(token)
            if (session.subscribers.size === 0) scheduleReaper(session)
          }
        },
        detach: () => {
          if (subscriber.detached) return
          subscriber.detached = true
          subscriber.pending.length = 0
          subscriber.end = undefined
          session.subscribers.delete(token)
          if (session.subscribers.size === 0) scheduleReaper(session)
        },
      }
    })

    return Service.of({ list, get, create, update, remove, write, attach })
  }),
)

export const layer = makeLayer()

export const configured = (options?: Options) =>
  makeLocationNode({
    service: Service,
    layer: options === undefined ? layer : makeLayer(options),
    deps: [Bus.node, Location.node, ShellSelect.node],
  })

export const node = configured()
