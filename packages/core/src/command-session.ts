import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { EventV2 } from "./event"
import { ID, Info, Status } from "@opencode-ai/schema/command-event"
import { Duration, Queue, Stream } from "effect"

type ActiveSession = {
  id: string
  command: string
  args: string[]
  cwd: string
  pid: number
  status: string
  exitCode: number | null
  signal: string | null
  startedAt: string
  runtimeMs: number
  idleMs: number
  lastActivity: number
  stdoutBuffer: string
  stderrBuffer: string
  maxRuntimeMs?: number
  inactivityTimeoutMs?: number
  killed: boolean
  process: any
  idleTimer: NodeJS.Timeout | null
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("CommandSession.NotFound", {
  sessionId: Schema.String,
}) {}

export class InvalidStatusError extends Schema.TaggedErrorClass<InvalidStatusError>()("CommandSession.InvalidStatus", {
  sessionId: Schema.String,
  status: Schema.String,
}) {}

export interface Interface {
  readonly start: (input: {
    command: string
    args: string[]
    cwd: string
    env?: Record<string, string>
    maxRuntimeMs?: number
    inactivityTimeoutMs?: number
  }) => Effect.Effect<{ id: string; info: Info }, unknown>
  readonly poll: (id: string, cursor: { stdout: number; stderr: number }) => Effect.Effect<
    {
      info: Info
      stdoutDelta: string
      stderrDelta: string
      hasMore: boolean
    },
    NotFoundError
  >
  readonly write: (id: string, data: string, stream: "stdout" | "stderr") => Effect.Effect<void, NotFoundError>
  readonly interrupt: (id: string) => Effect.Effect<void, NotFoundError | InvalidStatusError>
  readonly terminate: (id: string) => Effect.Effect<void, NotFoundError | InvalidStatusError>
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info, NotFoundError>
  readonly remove: (id: string) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CommandSession") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const spawner = yield* ChildProcessSpawner
    const sessions = new Map<string, ActiveSession>()

    const start = Effect.fn("CommandSession.start")(function*(
      input: {
        command: string
        args: string[]
        cwd: string
        env?: Record<string, string>
        maxRuntimeMs?: number
        inactivityTimeoutMs?: number
      },
    ) {
      const id = `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const now = Date.now()

      const proc = yield* spawner.spawn(
        ChildProcess.make(input.command, input.args, {
          cwd: input.cwd,
          env: {
            ...process.env,
            ...(input.env ?? {}),
            TERM: process.env.TERM ?? "xterm-256color",
          },
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
          detached: true,
        }),
      )

      const session: ActiveSession = {
        id,
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        pid: proc.pid,
        status: "running",
        exitCode: null,
        signal: null,
        startedAt: new Date(now).toISOString(),
        runtimeMs: 0,
        idleMs: 0,
        lastActivity: now,
        stdoutBuffer: "",
        stderrBuffer: "",
        maxRuntimeMs: input.maxRuntimeMs,
        inactivityTimeoutMs: input.inactivityTimeoutMs,
        killed: false,
        process: proc,
        idleTimer: null,
      }

      sessions.set(id, session)

      return { id, info: session as unknown as Info }
    })

    const poll = Effect.fn("CommandSession.poll")(function*(
      id: string,
      cursor: { stdout: number; stderr: number },
    ) {
      const session = sessions.get(id)
      if (!session) {
        return yield* new NotFoundError({ sessionId: id })
      }
      return {
        info: session as unknown as Info,
        stdoutDelta: "",
        stderrDelta: "",
        hasMore: false,
      }
    })

    const write = Effect.fn("CommandSession.write")(function*(id: string, data: string, stream: "stdout" | "stderr") {
      const session = sessions.get(id)
      if (!session) {
        return yield* new NotFoundError({ sessionId: id })
      }
    })

    const interrupt = Effect.fn("CommandSession.interrupt")(function*(id: string) {
      const session = sessions.get(id)
      if (!session) {
        return yield* new NotFoundError({ sessionId: id })
      }
      if (session.status === "exited" || session.status === "failed") {
        return yield* new InvalidStatusError({ sessionId: id, status: session.status })
      }
    })

    const terminate = Effect.fn("CommandSession.terminate")(function*(id: string) {
      const session = sessions.get(id)
      if (!session) {
        return yield* new NotFoundError({ sessionId: id })
      }
      if (session.status === "exited" || session.status === "failed") {
        return yield* new InvalidStatusError({ sessionId: id, status: session.status })
      }
      session.killed = true
    })

    const list = Effect.fn("CommandSession.list")(function*() {
      return Array.from(sessions.values()).map((s) => s as unknown as Info)
    })

    const get = Effect.fn("CommandSession.get")(function*(id: string) {
      const session = sessions.get(id)
      if (!session) {
        return yield* new NotFoundError({ sessionId: id })
      }
      return session as unknown as Info
    })

    const remove = Effect.fn("CommandSession.remove")(function*(id: string) {
      sessions.delete(id)
    })

    return Service.of({ start: start as any, poll: poll as any, write: write as any, interrupt: interrupt as any, terminate: terminate as any, list: list as any, get: get as any, remove: remove as any })
  }),
)

import { makeGlobalNode } from "./effect/app-node"
import { CrossSpawnSpawner } from "./cross-spawn-spawner"

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [EventV2.node, CrossSpawnSpawner.node],
})

export const CommandSession = {
  Service,
  node,
  NotFoundError,
  InvalidStatusError,
}
