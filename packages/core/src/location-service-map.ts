import { Clock, Context, Duration, Effect, Layer, LayerMap, Schema } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Node } from "@opencode-ai/util/effect/app-node"
import { Location } from "./location.js"
import type { LocationError, LocationServices } from "./location-services.js"
import type { Bus } from "./bus.js"
import { SessionEvent } from "./session/event.js"
import type { SessionStore } from "./session/store.js"

const isSessionEvent = Schema.is(SessionEvent.Durable)

export interface Interface extends LayerMap.LayerMap<Location.Ref, LocationServices> {
  readonly touch: (ref: Location.Ref) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/example/LocationServiceMap") {
  static get(ref: Location.Ref) {
    return Layer.unwrap(Effect.map(Service, (locations) => locations.get(ref)))
  }
}

export function make<R>(
  lookup: (ref: Location.Ref) => Layer.Layer<LocationServices, LocationError, R>,
  options: {
    readonly canonical?: (ref: Location.Ref) => Location.Ref
    readonly activityTimeToLive?: Duration.Input | ((ref: Location.Ref) => Duration.Input)
    readonly sweepInterval?: Duration.Input
    readonly activity?: {
      readonly observe: (subscriber: Bus.Subscriber) => Effect.Effect<Bus.Unsubscribe>
      readonly getSession: SessionStore.Interface["get"]
    }
  } = {},
) {
  return Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const canonical = options.canonical ?? ((ref: Location.Ref) => ref)
    const activityTimeToLive = options.activityTimeToLive
    const activityDuration =
      typeof activityTimeToLive === "function"
        ? (ref: Location.Ref) => Duration.toMillis(activityTimeToLive(ref))
        : () => Duration.toMillis(activityTimeToLive ?? "60 minutes")
    const entries = new Map<string, { readonly ref: Location.Ref; expiresAt: number }>()
    const key = (ref: Location.Ref) => `${ref.directory}\0${ref.workspaceID ?? ""}`
    const register = (ref: Location.Ref) =>
      Effect.sync(() => {
        const value = canonical(ref)
        const id = key(value)
        if (entries.has(id)) return
        entries.set(id, {
          ref: value,
          expiresAt: clock.currentTimeMillisUnsafe() + activityDuration(value),
        })
      })
    const locations = yield* LayerMap.make(
      (ref: Location.Ref) => lookup(ref).pipe(Layer.tap(() => register(ref))),
      { idleTimeToLive: Duration.infinity },
    )
    const invalidate = (ref: Location.Ref) => {
      const value = canonical(ref)
      entries.delete(key(value))
      return locations.invalidate(value)
    }
    const touch = (ref: Location.Ref) =>
      Effect.sync(() => {
        const value = canonical(ref)
        const entry = entries.get(key(value))
        if (!entry) return
        entry.expiresAt = clock.currentTimeMillisUnsafe() + activityDuration(value)
      })
    const contextEffect = (ref: Location.Ref) => {
      const value = canonical(ref)
      return locations.contextEffect(value).pipe(Effect.onError(() => locations.invalidate(value)))
    }

    if (options.activity) {
      const activity = options.activity
      const unsubscribe = yield* activity.observe((event) => {
        if (!isSessionEvent(event)) return Effect.void
        return Effect.gen(function* () {
          const location = event.location ?? (yield* activity.getSession(event.data.sessionID))?.location
          if (location) yield* touch(location)
        })
      })
      yield* Effect.addFinalizer(() => unsubscribe)
    }

    yield* Effect.gen(function* () {
      yield* Effect.sleep(options.sweepInterval ?? "1 minute")
      const now = clock.currentTimeMillisUnsafe()
      const expired = Array.from(entries.values()).filter((entry) => entry.expiresAt <= now)
      yield* Effect.forEach(
        expired,
        (entry) =>
          Effect.logInfo("location services evicted", {
            directory: entry.ref.directory,
            workspaceID: entry.ref.workspaceID,
          }).pipe(Effect.andThen(invalidate(entry.ref))),
        { discard: true },
      )
    }).pipe(Effect.forever, Effect.forkScoped)

    return Service.of({
      ...locations,
      get: (ref) => Layer.effectContext(contextEffect(ref)),
      contextEffect,
      invalidate,
      touch,
    })
  })
}

export const node = LayerNode.unbound(Service, Node.tags.values.global)

export * as LocationServiceMap from "./location-service-map.js"
