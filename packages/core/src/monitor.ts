export * as Monitor from "./monitor.js"

import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import { Monitor } from "@opencode/schema/monitor"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionEvent } from "@opencode/schema/session-event"
import type { Info, Output, OutputInput } from "@opencode/schema/shell"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Cause, Clock, Context, Deferred, Effect, Exit, Layer, Schema, Scope, Stream } from "effect"
import { open, rm } from "node:fs/promises"
import { Bus } from "./bus.js"
import { Job } from "./job.js"
import { KV } from "./kv.js"
import { MonitorOutput } from "./monitor/output.js"
import { Session } from "./session.js"
import { SessionSchema } from "./session/schema.js"
import { Shell } from "./shell.js"

export const DEFAULT_TIMEOUT_MS = 300_000
export const MAX_TIMEOUT_MS = 1_800_000
export const BATCH_MS = 200
export const RATE_WINDOW_MS = 30_000
export const MAX_EVENTS_PER_WINDOW = 30
export const MAX_LOG_BYTES = 1024 * 1024
export const MAX_ACTIVE = 4
const PREFIX = "monitor/"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Monitor.NotFoundError", {
  id: Monitor.ID,
}) {}

export const Input = Schema.Struct({
  command: Schema.String.check(Schema.isMinLength(1)),
  description: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  delivery: Schema.optionalKey(SessionInbox.Delivery).annotate({
    description: "Defaults to steer: deliver at the next safe step boundary. Use queue to wait until the turn ends.",
  }),
  timeoutMs: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(MAX_TIMEOUT_MS))),
})
export type Input = typeof Input.Type

export interface Options {
  sessionID: SessionSchema.ID
  shell: Shell.Interface
  shellPath: string
  before: (invocation: ShellCreateBefore) => Effect.Effect<void, unknown>
}

export interface Interface {
  readonly start: (input: Input, options: Options) => Effect.Effect<Monitor.Info, unknown>
  readonly stop: (input: { id: Monitor.ID; sessionID: SessionSchema.ID }) => Effect.Effect<Monitor.Info, NotFoundError>
  readonly list: (sessionID: SessionSchema.ID) => Effect.Effect<Monitor.Info[]>
  readonly output: (
    input: { id: Monitor.ID; sessionID: SessionSchema.ID } & OutputInput,
  ) => Effect.Effect<Output, NotFoundError>
  readonly recover: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Monitor") {}

export function label(description: string, lines: readonly string[]) {
  const safe = description.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").replaceAll("'", "’")
  return `[background event from monitor '${safe}' — not a user message]: ${lines.join("\n")}`
}

type Active = {
  info: Monitor.Info
  reason?: Monitor.Reason
  done: Deferred.Deferred<Monitor.Info>
}

export const make: Effect.Effect<
  Interface,
  never,
  KV.Service | Job.Service | Bus.Service | Session.Service | Scope.Scope
> = Effect.gen(function* () {
  const kv = yield* KV.Service
  const jobs = yield* Job.Service
  const bus = yield* Bus.Service
  const sessions = yield* Session.Service
  const clock = yield* Clock.Clock
  const scope = yield* Scope.Scope
  const encode = Schema.encodeSync(Monitor.Info)
  const active = new Map<Monitor.ID, Active>()
  const starting = new Map<SessionSchema.ID, number>()
  const key = (info: Pick<Monitor.Info, "sessionID" | "id">) => `${PREFIX}${info.sessionID}/${info.id}`

  const read = Effect.fnUntraced(function* (prefix: string) {
    const result: Monitor.Info[] = []
    let after: string | undefined
    do {
      const page = yield* kv.scan({ prefix, after })
      for (const entry of page.entries) result.push(Schema.decodeUnknownSync(Monitor.Info)(entry.value))
      after = page.next
    } while (after)
    return result
  })

  const notify = (info: Monitor.Info, lines: readonly string[], resume = true) =>
    sessions
      .synthetic({
        sessionID: info.sessionID,
        text: label(info.description, lines),
        description: info.description,
        metadata: { source: "monitor", monitorID: info.id },
        delivery: info.delivery,
        resume,
      })
      .pipe(
        Effect.asVoid,
        Effect.catchTag("Session.NotFoundError", () => Effect.void),
        Effect.orDie,
      )

  const discard = Effect.fnUntraced(function* (info: Monitor.Info) {
    yield* Effect.promise(() => rm(info.log, { force: true }))
    yield* kv.remove(key(info))
  })

  const list: Interface["list"] = Effect.fnUntraced(function* (sessionID) {
    const items = yield* read(`${PREFIX}${sessionID}/`)
    const retained = Monitor.retain(items)
    const ids = new Set(retained.map((item) => item.id))
    yield* Effect.forEach(
      items.filter((item) => !ids.has(item.id)),
      discard,
      { discard: true },
    )
    return retained
  })

  const output: Interface["output"] = Effect.fn("Monitor.output")(function* (input) {
    const item = yield* kv.get(key(input))
    if (!item) return yield* new NotFoundError({ id: input.id })
    const info = Schema.decodeUnknownSync(Monitor.Info)(item)
    const attempt = <A>(run: () => Promise<A>) =>
      Effect.tryPromise({ try: run, catch: () => new NotFoundError({ id: input.id }) })
    return yield* Effect.acquireUseRelease(
      attempt(() => open(info.log, "r")),
      (file) =>
        Effect.gen(function* () {
          const size = (yield* attempt(() => file.stat())).size
          const cursor = Math.min(Math.max(0, input.cursor ?? 0), size)
          const buffer = Buffer.alloc(Math.min(Math.max(0, input.limit ?? 65536), 65536, size - cursor))
          const { bytesRead } = yield* attempt(() => file.read(buffer, 0, buffer.length, cursor))
          return {
            output: buffer.subarray(0, bytesRead).toString("utf8"),
            cursor: cursor + bytesRead,
            size,
            truncated: false,
          }
        }),
      (file) => Effect.promise(() => file.close()),
    )
  })

  yield* bus.subscribe(SessionEvent.Deleted).pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        for (const state of [...active.values()].filter((item) => item.info.sessionID === event.data.sessionID)) {
          state.reason = "cancelled"
          yield* jobs.cancel(state.info.id)
          yield* Deferred.await(state.done)
        }
        yield* Effect.forEach(yield* read(`${PREFIX}${event.data.sessionID}/`), discard, { discard: true })
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )

  const start: Interface["start"] = Effect.fn("Monitor.start")(function* (input, options) {
    const count = [...active.values()].filter((item) => item.info.sessionID === options.sessionID).length
    const pending = starting.get(options.sessionID) ?? 0
    if (count + pending >= MAX_ACTIVE)
      return yield* Effect.fail(new Error(`At most ${MAX_ACTIVE} monitors may run per session`))
    starting.set(options.sessionID, pending + 1)
    let owned: Active | undefined
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const id = Monitor.ID.create()
        const output = MonitorOutput.make()
        let wake = Deferred.makeUnsafe<void>()
        let accepting = true
        let shutdown = false
        let exit: Info | undefined
        const signal = () => Deferred.doneUnsafe(wake, Exit.void)
        const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
        const shell = yield* options.shell.create(
          {
            command: input.command,
            shell: options.shellPath,
            timeout,
            metadata: { sessionID: options.sessionID, monitorID: id },
          },
          (invocation) =>
            restore(options.before(invocation)).pipe(
              Effect.andThen(sessions.get(options.sessionID)),
              // Monitor deadlines cannot be disabled or extended by shell hooks.
              Effect.tap(() =>
                Effect.sync(() => {
                  invocation.timeout = timeout
                }),
              ),
            ),
          {
            stdout: (chunk) => {
              if (!accepting) return
              output.write(chunk)
              if (output.pending || output.exceeded) signal()
            },
            maxBytes: MAX_LOG_BYTES,
            forceKill: true,
            retainOutput: true,
          },
        )
        yield* sessions
          .get(options.sessionID)
          .pipe(
            Effect.onError(() =>
              options.shell
                .stop(shell.id)
                .pipe(
                  Effect.orDie,
                  Effect.andThen(Effect.promise(() => rm(shell.file, { force: true }))),
                  Effect.asVoid,
                ),
            ),
          )
        const startedAt = clock.currentTimeMillisUnsafe()
        const state: Active = {
          info: {
            id,
            sessionID: options.sessionID,
            shellID: shell.id,
            description: input.description,
            delivery: input.delivery ?? "steer",
            ...(shell.pid === undefined ? {} : { pid: shell.pid }),
            log: shell.file,
            startedAt,
            expiresAt: startedAt + timeout,
            eventCount: 0,
            outputBytes: 0,
            status: "running",
          },
          done: Deferred.makeUnsafe<Monitor.Info>(),
        }
        const admitted = Deferred.makeUnsafe<void>()
        const times: number[] = []
        const rateExceeded = () => {
          const now = clock.currentTimeMillisUnsafe()
          while (times.length && times[0] <= now - RATE_WINDOW_MS) times.shift()
          return now - startedAt >= RATE_WINDOW_MS && times.length > MAX_EVENTS_PER_WINDOW
        }
        const deliver = Effect.fnUntraced(function* (final = false) {
          for (const lines of output.take(final)) {
            times.push(clock.currentTimeMillisUnsafe())
            if (rateExceeded()) {
              state.reason = "rate_limit"
              break
            }
            state.info = { ...state.info, eventCount: state.info.eventCount + 1, outputBytes: output.bytes }
            // Persist the read model before clients observe it, and use the existing durable inbox for wakes.
            yield* kv.set(key(state.info), encode(state.info))
            yield* notify(state.info, lines)
            yield* bus.publish(Monitor.Event.Output, { info: state.info, lines })
          }
        })
        const finish = Effect.fnUntraced(function* () {
          accepting = false
          if (!exit) {
            exit = yield* options.shell
              .stop(shell.id)
              .pipe(Effect.catchTag("Shell.NotFoundError", () => Effect.succeed(undefined)))
          }
          yield* Deferred.await(admitted)
          if (shutdown) return
          const exists = yield* sessions.get(state.info.sessionID).pipe(
            Effect.as(true),
            Effect.catchTag("Session.NotFoundError", () => Effect.succeed(false)),
          )
          if (!exists) {
            state.info = {
              ...state.info,
              status: "ended",
              reason: "cancelled",
              endedAt: clock.currentTimeMillisUnsafe(),
            }
            yield* discard(state.info)
            return
          }
          if (output.exceeded) state.reason = "output_limit"
          yield* deliver(true)
          if (output.exceeded) state.reason = "output_limit"
          const reason = state.reason ?? "server_restarted"
          state.info = {
            ...state.info,
            status: "ended",
            reason,
            outputBytes: output.bytes,
            endedAt: clock.currentTimeMillisUnsafe(),
            ...(exit?.exit === undefined ? {} : { exitCode: exit.exit }),
          }
          yield* kv.set(key(state.info), encode(state.info))
          yield* list(state.info.sessionID)
          const summary =
            reason === "exited"
              ? `exited with code ${exit?.exit ?? "unknown"}, ${state.info.eventCount} events`
              : reason === "expired"
                ? `expired, ${state.info.eventCount} events`
                : reason === "rate_limit"
                  ? `stopped: rate limit exceeded (more than ${MAX_EVENTS_PER_WINDOW} events in 30 s), ${state.info.eventCount} events`
                  : reason === "output_limit"
                    ? `stopped: output limit exceeded, ${state.info.eventCount} events`
                    : `${reason}, ${state.info.eventCount} events`
          yield* notify(state.info, [summary], reason !== "server_restarted")
          yield* bus.publish(Monitor.Event.Ended, { info: state.info })
        })
        const run = Effect.scoped(
          Effect.gen(function* () {
            yield* Deferred.await(admitted)
            yield* Effect.sleep(Math.max(0, state.info.expiresAt - clock.currentTimeMillisUnsafe())).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  state.reason ??= "expired"
                  signal()
                }),
              ),
              Effect.forkScoped,
            )
            yield* options.shell.wait(shell.id).pipe(
              Effect.tap((result) =>
                Effect.sync(() => {
                  exit = result
                  state.reason ??=
                    result.status === "timeout" ? "expired" : result.status === "exited" ? "exited" : "cancelled"
                  signal()
                }),
              ),
              Effect.catchTag("Shell.NotFoundError", () =>
                Effect.sync(() => {
                  state.reason = "cancelled"
                  signal()
                }),
              ),
              Effect.forkScoped,
            )
            yield* Effect.sleep(RATE_WINDOW_MS).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  if (rateExceeded()) state.reason = "rate_limit"
                  signal()
                }),
              ),
              Effect.forkScoped,
            )
            while (!state.reason) {
              yield* Deferred.await(wake)
              wake = Deferred.makeUnsafe<void>()
              if (output.exceeded) state.reason = "output_limit"
              if (state.reason) break
              if (output.pending) {
                yield* Effect.sleep(BATCH_MS)
                yield* deliver()
              }
            }
            return "Monitor ended"
          }),
        ).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              shutdown = state.reason === undefined
            }),
          ),
          Effect.onExit((outcome) =>
            Effect.sync(() => {
              if (Exit.isFailure(outcome) && !Cause.hasInterruptsOnly(outcome.cause)) state.reason = "error"
            }),
          ),
          Effect.ensuring(
            finish().pipe(
              Effect.onExit((outcome) =>
                Effect.gen(function* () {
                  if (Exit.isSuccess(outcome) || shutdown || state.info.status === "ended") return
                  state.info = {
                    ...state.info,
                    status: "ended",
                    reason: "error",
                    endedAt: clock.currentTimeMillisUnsafe(),
                    outputBytes: output.bytes,
                  }
                  yield* kv.set(key(state.info), encode(state.info))
                  yield* list(state.info.sessionID)
                  yield* bus.publish(Monitor.Event.Ended, { info: state.info })
                }),
              ),
              Effect.ensuring(
                Effect.gen(function* () {
                  active.delete(id)
                  yield* Deferred.succeed(state.done, state.info)
                }),
              ),
            ),
          ),
        )
        yield* jobs.start({
          id,
          type: "monitor",
          title: input.description,
          metadata: { sessionID: options.sessionID, shellID: shell.id },
          run: Effect.interruptible(run),
        })
        active.set(id, state)
        owned = state
        yield* Effect.gen(function* () {
          yield* sessions.get(options.sessionID)
          yield* kv.set(key(state.info), encode(state.info))
          yield* bus.publish(Monitor.Event.Started, { info: state.info })
        }).pipe(
          Effect.ensuring(Deferred.succeed(admitted, undefined)),
          Effect.onExit((outcome) =>
            Exit.isFailure(outcome)
              ? Effect.sync(() => {
                  state.reason = "error"
                }).pipe(Effect.andThen(jobs.cancel(id)))
              : Effect.void,
          ),
        )
        yield* jobs.background(id)
        yield* jobs.wait({ id }).pipe(Effect.interruptible, Effect.forkIn(scope))
        return state.info
      }),
    ).pipe(
      // Cancellation is deferred while ownership is being recorded. If the caller
      // never receives the task ID, do not leave its newly spawned monitor behind.
      Effect.onInterrupt(() =>
        Effect.gen(function* () {
          if (!owned || owned.info.status !== "running") return
          owned.reason ??= "cancelled"
          yield* jobs.cancel(owned.info.id)
          yield* Deferred.await(owned.done)
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          const remaining = (starting.get(options.sessionID) ?? 1) - 1
          if (remaining) starting.set(options.sessionID, remaining)
          else starting.delete(options.sessionID)
        }),
      ),
    )
  })

  const stop: Interface["stop"] = Effect.fn("Monitor.stop")(function* (input) {
    const state = active.get(input.id)
    if (!state || state.info.sessionID !== input.sessionID) {
      const item = yield* kv.get(key(input))
      if (!item) return yield* new NotFoundError({ id: input.id })
      return Schema.decodeUnknownSync(Monitor.Info)(item)
    }
    state.reason = "cancelled"
    yield* jobs.cancel(input.id)
    return yield* Deferred.await(state.done)
  })

  const recover = Effect.gen(function* () {
    for (const previous of yield* read(PREFIX)) {
      const exists = yield* sessions.get(previous.sessionID).pipe(
        Effect.as(true),
        Effect.catchTag("Session.NotFoundError", () => Effect.succeed(false)),
      )
      if (!exists) {
        yield* discard(previous)
        continue
      }
      if (previous.status !== "running" || active.has(previous.id)) continue
      const info: Monitor.Info = {
        ...previous,
        status: "ended",
        reason: "server_restarted",
        endedAt: clock.currentTimeMillisUnsafe(),
      }
      yield* kv.set(key(info), encode(info))
      // Never signal a saved PID after restart: the OS may have reused it.
      yield* notify(info, [`ended: server restarted, ${info.eventCount} events`], false)
      yield* bus.publish(Monitor.Event.Ended, { info })
    }
    for (const sessionID of new Set((yield* read(PREFIX)).map((info) => info.sessionID))) yield* list(sessionID)
  })

  return Service.of({ start, stop, list, output, recover })
})

export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [KV.node, Job.node, Bus.node, Session.node],
})
