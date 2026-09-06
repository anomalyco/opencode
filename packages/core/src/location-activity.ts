export * as LocationActivity from "./location-activity.js"

import { Clock, Context, Duration, Effect, Layer, RcMap, Schema } from "effect"
import { Bus } from "./bus.js"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"
import { SessionEvent } from "./session/event.js"
import { SessionExecution } from "./session/execution.js"
import { SessionStore } from "./session/store.js"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"

const isSessionEvent = Schema.is(SessionEvent.Durable)

export class Service extends Context.Service<Service, {}>()("@opencode/LocationActivity") {}

export function layer(options: { readonly timeToLive?: Duration.Input; readonly sweepInterval?: Duration.Input } = {}) {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      const bus = yield* Bus.Service
      const locations = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const sessions = yield* SessionStore.Service
      const timeToLive = Duration.toMillis(options.timeToLive ?? "60 minutes")
      const entries = new Map<string, { readonly ref: Location.Ref; expiresAt: number }>()
      const key = (ref: Location.Ref) => `${ref.directory}\0${ref.workspaceID ?? ""}`
      const touch = (ref: Location.Ref) =>
        Effect.sync(() => {
          entries.set(key(ref), { ref, expiresAt: clock.currentTimeMillisUnsafe() + timeToLive })
        })

      const unsubscribe = yield* bus.listen((event) => {
        if (!isSessionEvent(event)) return Effect.void
        const location = event.location
        if (!location) return Effect.void
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
        const now = clock.currentTimeMillisUnsafe()
        const expired = Array.from(entries.values()).filter((entry) => entry.expiresAt <= now)
        if (expired.length === 0) return
        const active = yield* Effect.forEach(yield* execution.active, (sessionID) => sessions.get(sessionID))
        const occupied = new Set(active.flatMap((session) => (session ? [key(session.location)] : [])))
        yield* Effect.forEach(
          expired,
          (entry) => {
            // Waiting for a question or a long-running tool emits no activity.
            // Invalidating a borrowed graph would strand it behind a new cache entry.
            if (occupied.has(key(entry.ref))) return touch(entry.ref)
            entries.delete(key(entry.ref))
            return Effect.logInfo("location services evicted", {
              directory: entry.ref.directory,
              workspaceID: entry.ref.workspaceID,
            }).pipe(Effect.andThen(locations.invalidate(entry.ref)))
          },
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
  deps: [Bus.node, LocationServiceMap.node, SessionExecution.node, SessionStore.node],
})
