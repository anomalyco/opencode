export * as SessionSchedule from "./schedule.js"

import { Clock, Context, Duration, Effect, Fiber, Layer, Option, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Identifier } from "../id/id.js"
import { KV } from "../kv.js"
import { Session } from "../session.js"
import { SessionSchema } from "./schema.js"

export const Info = Schema.Struct({
  id: Schema.String,
  sessionID: SessionSchema.ID,
  text: Schema.String,
  /** Next fire time in epoch milliseconds. Persisted so restarts keep the cadence. */
  next: Schema.Number,
  /** Repeat interval in milliseconds; absent for one-shot schedules. */
  every: Schema.optionalKey(Schema.Number),
})
export type Info = typeof Info.Type
const decodeInfo = Schema.decodeUnknownOption(Info)
const prefix = "session.schedule/"

const units = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** Parses an interval such as `30s`, `15m`, `2h` or `1d` into milliseconds. */
export function parseInterval(input: string) {
  const match = /^(\d+)([smhd])$/.exec(input.trim())
  if (!match) return
  const value = Number(match[1]) * units[match[2] as keyof typeof units]
  return value > 0 ? value : undefined
}

export interface Interface {
  /** Saves a prompt that fires once at `at`, or every `every` ms starting one interval from now. */
  readonly create: (input: {
    sessionID: SessionSchema.ID
    text: string
    at?: number
    every?: number
  }) => Effect.Effect<Info>
  readonly cancel: (id: string) => Effect.Effect<void>
  readonly list: (sessionID: SessionSchema.ID) => Effect.Effect<readonly Info[]>
  /**
   * Starts timers for every saved schedule. Timers live in this global service rather than in a
   * Location, so they keep firing while the Session's Location is unloaded; each prompt loads it on
   * demand. Overdue schedules fire once immediately. Inert until called: the managed server calls it
   * once at boot.
   */
  readonly resume: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSchedule") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const sessions = yield* Session.Service
    const scope = yield* Effect.scope
    const running = new Map<string, Fiber.Fiber<void>>()

    const stop = Effect.fnUntraced(function* (id: string) {
      const fiber = running.get(id)
      running.delete(id)
      if (fiber) yield* Fiber.interrupt(fiber)
    })

    const start = Effect.fnUntraced(function* (info: Info) {
      yield* stop(info.id)
      const loop = (current: Info): Effect.Effect<void> =>
        Effect.gen(function* () {
          const wait = current.next - (yield* Clock.currentTimeMillis)
          if (wait > 0) yield* Effect.sleep(Duration.millis(wait))
          const exists = yield* sessions
            .prompt({ sessionID: current.sessionID, text: current.text, delivery: "queue" })
            .pipe(
              Effect.as(true),
              Effect.catchTag("Session.NotFoundError", () => Effect.succeed(false)),
              Effect.catchCause((cause) =>
                Effect.logWarning("scheduled prompt failed", { id: current.id, cause }).pipe(Effect.as(true)),
              ),
            )
          // One-shot schedules and schedules of deleted Sessions end here.
          if (!exists || current.every === undefined) {
            running.delete(current.id)
            return yield* kv.remove(prefix + current.id)
          }
          // Skip occurrences missed while the server was down instead of firing them in a burst.
          const now = yield* Clock.currentTimeMillis
          const next = { ...current, next: Math.max(current.next + current.every, now + current.every) }
          yield* kv.set(prefix + current.id, next)
          return yield* loop(next)
        })
      running.set(info.id, yield* Effect.forkIn(loop(info), scope))
    })

    const all = Effect.gen(function* () {
      const saved = yield* kv.scan({ prefix, limit: 1000 })
      return saved.entries.flatMap((item) => Option.toArray(decodeInfo(item.value)))
    })

    return Service.of({
      create: Effect.fnUntraced(function* (input) {
        const now = yield* Clock.currentTimeMillis
        const info: Info = {
          id: Identifier.ascending("schedule"),
          sessionID: input.sessionID,
          text: input.text,
          next: input.at ?? now + (input.every ?? 0),
          ...(input.every === undefined ? {} : { every: input.every }),
        }
        yield* kv.set(prefix + info.id, info)
        yield* start(info)
        return info
      }),
      cancel: Effect.fnUntraced(function* (id) {
        yield* stop(id)
        yield* kv.remove(prefix + id)
      }),
      list: (sessionID) => all.pipe(Effect.map((infos) => infos.filter((info) => info.sessionID === sessionID))),
      resume: Effect.gen(function* () {
        yield* Effect.forEach(yield* all, start, { discard: true })
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node, Session.node] })
