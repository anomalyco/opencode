export * as SessionSchedule from "./schedule.js"

import { Context, Effect, Layer, Schedule, Schema } from "effect"
import { SessionSchedule } from "@opencode/schema/session-schedule"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { KV } from "../kv.js"
import { Session } from "../session.js"

export class Error extends Schema.TaggedError<Error>()("SessionSchedule.Error", { message: Schema.String }) {}

export interface Interface {
  readonly list: (sessionID: Session.ID) => Effect.Effect<readonly SessionSchedule.Info[]>
  readonly save: (
    sessionID: Session.ID,
    input: SessionSchedule.Input,
    id?: string,
  ) => Effect.Effect<SessionSchedule.Info, Session.NotFoundError | Error>
  readonly remove: (sessionID: Session.ID, id: string) => Effect.Effect<void>
  readonly sendDue: (now: number) => Effect.Effect<void>
  readonly run: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSchedule") {}

const key = "session.schedules"
const decode = Schema.decodeUnknownSync(Schema.Array(SessionSchedule.Info))

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const sessions = yield* Session.Service
    const lock = KeyedMutex.makeUnsafe<string>().withLock(key)
    const read = () => kv.get(key).pipe(Effect.map((value) => decode(value ?? [])))
    const sendDue = (now: number) =>
      lock(
        Effect.gen(function* () {
          const entries = yield* read()
          const next = yield* Effect.forEach(entries, (entry) =>
            Effect.gen(function* () {
              if (!entry.enabled || entry.nextAt === null || entry.nextAt > now) return entry
              const exists = yield* sessions.get(entry.sessionID).pipe(
                Effect.as(true),
                Effect.catchTag("Session.NotFoundError", () => Effect.succeed(false)),
              )
              if (!exists) return undefined
              yield* sessions
                .prompt({
                  sessionID: entry.sessionID,
                  text: entry.text,
                  delivery: "steer",
                  metadata: { scheduleID: entry.id },
                })
                .pipe(Effect.orDie)
              return { ...entry, nextAt: now + entry.intervalMinutes * 60_000 }
            }),
          )
          if (entries.some((entry) => entry.enabled && entry.nextAt !== null && entry.nextAt <= now))
            yield* kv.set(
              key,
              next.filter((entry) => entry !== undefined),
            )
        }),
      )
    return Service.of({
      list: (sessionID) =>
        read().pipe(Effect.map((entries) => entries.filter((entry) => entry.sessionID === sessionID))),
      save: (sessionID, input, id) =>
        lock(
          Effect.gen(function* () {
            yield* sessions.get(sessionID)
            const entries = yield* read()
            if (id !== undefined && !entries.some((entry) => entry.id === id && entry.sessionID === sessionID))
              return yield* new Error({ message: "Schedule not found" })
            const entry = {
              ...input,
              id: id ?? crypto.randomUUID(),
              sessionID,
              nextAt: input.enabled ? Date.now() + input.intervalMinutes * 60_000 : null,
            }
            yield* kv.set(key, [...entries.filter((item) => item.id !== entry.id), entry])
            return entry
          }),
        ),
      remove: (sessionID, id) =>
        lock(
          Effect.gen(function* () {
            yield* kv.set(
              key,
              (yield* read()).filter((entry) => entry.sessionID !== sessionID || entry.id !== id),
            )
          }),
        ),
      sendDue,
      run: Effect.gen(function* () {
        // Restart from a fresh interval, without replaying sends missed while the server was down.
        yield* lock(
          Effect.gen(function* () {
            const entries = yield* read()
            yield* kv.set(
              key,
              entries.map((entry) => ({
                ...entry,
                nextAt: entry.enabled ? Date.now() + entry.intervalMinutes * 60_000 : null,
              })),
            )
          }),
        )
        yield* Effect.suspend(() => sendDue(Date.now())).pipe(
          Effect.catchCause((cause) => Effect.logError("Scheduled message delivery failed", cause)),
          Effect.repeat(Schedule.spaced("1 second")),
          Effect.asVoid,
        )
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node, Session.node] })
