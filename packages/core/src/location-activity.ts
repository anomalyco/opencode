export * as LocationActivity from "./location-activity.js"

import { Clock, Context, Duration, Effect, Layer, Option, RcMap, Schema } from "effect"
import type { Document } from "@opencode/schema/config"
import { Bus } from "./bus.js"
import { Config } from "./config.js"
import { Job } from "./job.js"
import { Location } from "./location.js"
import { invalidateLocationIfIdle } from "./location-services.js"
import { LocationServiceMap } from "./location-service-map.js"
import { SessionEvent } from "./session/event.js"
import { SessionExecution } from "./session/execution.js"
import { SessionStore } from "./session/store.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

const isSessionEvent = Schema.is(SessionEvent.Durable)
const DEFAULT_LOCATION_LIMIT = 16

export class Service extends Context.Service<Service, {}>()("@opencode/LocationActivity") {}

export function layer(
  options: {
    readonly timeToLive?: Duration.Input
    readonly sweepInterval?: Duration.Input
    readonly limit?: number | false
  } = {},
) {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      const bus = yield* Bus.Service
      const locations = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const jobs = yield* Job.Service
      const sessions = yield* SessionStore.Service
      const timeToLive = Duration.fromInputUnsafe(options.timeToLive ?? "60 minutes")
      const limit = options.limit === false ? Number.POSITIVE_INFINITY : (options.limit ?? DEFAULT_LOCATION_LIMIT)
      const entries = new Map<string, { readonly ref: Location.Ref; touchedAt: number; accessedAt: number }>()
      const key = (ref: Location.Ref) => `${LocationServiceMap.canonical(ref).directory}\0${ref.workspaceID ?? ""}`
      // A live borrower is recent use for LRU order, but it is not session activity for idle expiry.
      const touch = (ref: Location.Ref, activity = true) =>
        Effect.sync(() => {
          const id = key(ref)
          const previous = entries.get(id)
          const now = clock.currentTimeMillisUnsafe()
          entries.delete(id)
          entries.set(id, {
            ref,
            touchedAt: activity ? now : (previous?.touchedAt ?? now),
            accessedAt: now,
          })
        })

      // Read per location so project config can override the global value.
      const idleTimeout = (ref: Location.Ref) =>
        Effect.gen(function* () {
          const context = yield* locations.contextEffectOption(ref)
          if (Option.isNone(context)) return timeToLive
          const entries = yield* Context.get(context.value, Config.Service).entries()
          const configured = entries.findLast(
            (entry): entry is Document =>
              entry.type === "document" && entry.info.experimental?.location_idle_timeout !== undefined,
          )
          return configured?.info.experimental?.location_idle_timeout ?? timeToLive
        }).pipe(
          Effect.scoped,
          Effect.orElseSucceed(() => timeToLive),
        )

      // Read per location so project config can override the global cache limit.
      const cacheLimit = (ref: Location.Ref) =>
        Effect.gen(function* () {
          const context = yield* locations.contextEffectOption(ref)
          if (Option.isNone(context)) return limit
          const entries = yield* Context.get(context.value, Config.Service).entries()
          const configured = entries.findLast(
            (entry): entry is Document =>
              entry.type === "document" && entry.info.experimental?.location_cache_limit !== undefined,
          )
          const value = configured?.info.experimental?.location_cache_limit
          return value === false ? Number.POSITIVE_INFINITY : (value ?? limit)
        }).pipe(
          Effect.scoped,
          Effect.orElseSucceed(() => limit),
        )

      const unsubscribe = yield* bus.listen((event) => {
        if (!isSessionEvent(event) || !event.location) return Effect.void
        const location = LocationServiceMap.canonical(event.location)
        return RcMap.has(locations.rcMap, location).pipe(
          Effect.flatMap((active) => (active ? touch(location) : Effect.void)),
        )
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* Effect.gen(function* () {
        yield* Effect.sleep(options.sweepInterval ?? "1 minute")
        const refs = Array.from(yield* RcMap.keys(locations.rcMap))
        const cached = new Set(refs.map(key))
        yield* Effect.forEach(refs, (ref) => (entries.has(key(ref)) ? Effect.void : touch(ref)), { discard: true })
        for (const id of entries.keys()) {
          if (!cached.has(id)) entries.delete(id)
        }
        // A location with a live borrower is in use even without a recent session event.
        if (locations.rcMap.state._tag === "Open")
          yield* Effect.forEach(
            locations.rcMap.state.map,
            ([ref, entry]) => (entry.refCount > 0 ? touch(ref, false) : Effect.void),
            { discard: true },
          )
        const smallestLimit = Math.min(...(yield* Effect.forEach(refs, cacheLimit)))
        const now = clock.currentTimeMillisUnsafe()
        const expired = yield* Effect.filter(Array.from(entries.values()), (entry) =>
          idleTimeout(entry.ref).pipe(
            Effect.map((timeout) => timeout !== false && entry.touchedAt + Duration.toMillis(timeout) <= now),
          ),
        )
        const expiredIDs = new Set(expired.map((entry) => key(entry.ref)))
        if (expiredIDs.size === 0 && refs.length <= smallestLimit) return
        // Waiting on a question, a long tool call, or a background job emits no durable activity.
        const owners = [
          ...(yield* execution.active),
          ...(yield* jobs.runningBackground).flatMap((recovery) =>
            recovery.kind === "subagent" ? [recovery.childSessionID, recovery.parentSessionID] : [recovery.sessionID],
          ),
        ]
        const occupied = new Set(
          (yield* Effect.forEach(owners, (sessionID) => sessions.get(sessionID))).flatMap((session) =>
            session ? [key(session.location)] : [],
          ),
        )
        yield* Effect.forEach(
          Array.from(entries.values()),
          (entry) =>
            Effect.gen(function* () {
              const id = key(entry.ref)
              if (entries.get(id) !== entry) return
              const isExpired = expiredIDs.has(id)
              const remaining = Array.from(yield* RcMap.keys(locations.rcMap)).length
              const entryLimit = yield* cacheLimit(entry.ref)
              if (!isExpired && remaining <= entryLimit) return
              if (occupied.has(id)) {
                if (isExpired) yield* touch(entry.ref)
                return
              }
              // A per-Location timeout of false is a promise never to unload it.
              if (!isExpired && (yield* idleTimeout(entry.ref)) === false) return
              const evicted = yield* invalidateLocationIfIdle(locations, entry.ref, {
                isProtected: () => occupied.has(id),
                protectBorrowers: !isExpired,
                canEvict: () =>
                  entries.get(id) === entry &&
                  (isExpired ||
                    (locations.rcMap.state._tag === "Open" &&
                      Array.from(locations.rcMap.state.map).length > entryLimit)),
              })
              if (!evicted) {
                if (isExpired) yield* touch(entry.ref)
                return
              }
              entries.delete(id)
              yield* Effect.logInfo("location services evicted", {
                directory: entry.ref.directory,
                workspaceID: entry.ref.workspaceID,
                reason: isExpired ? "idle" : "limit",
              })
            }),
          { discard: true },
        )
      }).pipe(Effect.forever, Effect.forkScoped)

      return Service.of({})
    }),
  )
}

export const node = makeGlobalNode({
  service: Service,
  layer: layer(),
  deps: [Bus.node, Job.node, LocationServiceMap.node, SessionExecution.node, SessionStore.node],
})
