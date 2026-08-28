export * as LocationActivity from "./location-activity.js"

import { Clock, Context, Duration, Effect, Layer, Schema } from "effect"
import { Bus } from "./bus.js"
import type { Instance } from "./instance.js"
import { Location } from "./location.js"
import { InstanceMap } from "./instance-map.js"
import { SessionEvent } from "./session/event.js"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"

const isSessionEvent = Schema.is(SessionEvent.Durable)

export class Service extends Context.Service<Service, {}>()("@opencode/LocationActivity") {}

export function layer(options: { readonly timeToLive?: Duration.Input; readonly sweepInterval?: Duration.Input } = {}) {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      const bus = yield* Bus.Service
      const locations = yield* InstanceMap.Service
      const timeToLive = Duration.toMillis(options.timeToLive ?? "60 minutes")
      const entries = new Map<Instance.Key, number>()
      const touch = (key: Instance.Key) =>
        Effect.sync(() => {
          entries.set(key, clock.currentTimeMillisUnsafe() + timeToLive)
        })

      const unsubscribe = yield* bus.listen((event) => {
        if (!isSessionEvent(event)) return Effect.void
        const location = event.location
        if (!location) return Effect.void
        const key = Location.instanceKey(location)
        return locations.has(location).pipe(Effect.flatMap((active) => (active ? touch(key) : Effect.void)))
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* Effect.gen(function* () {
        yield* Effect.sleep(options.sweepInterval ?? "1 minute")
        const cached = new Map((yield* locations.entries).map((entry) => [entry.key, entry.location]))
        yield* Effect.forEach(cached.keys(), (key) => (entries.has(key) ? Effect.void : touch(key)), { discard: true })
        for (const id of entries.keys()) {
          if (!cached.has(id)) entries.delete(id)
        }
        const now = clock.currentTimeMillisUnsafe()
        const expired = Array.from(cached).filter(([key]) => (entries.get(key) ?? Infinity) <= now)
        yield* Effect.forEach(
          expired,
          ([key, ref]) => {
            entries.delete(key)
            return Effect.logInfo("location services evicted", {
              directory: ref.directory,
              workspaceID: ref.workspaceID,
            }).pipe(Effect.andThen(locations.invalidate(ref)))
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
  deps: [Bus.node, InstanceMap.node],
})
