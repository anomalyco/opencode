export * as LocationActivity from "./location-activity.js"

import { Clock, Context, Duration, Effect, Layer, Option, Schema } from "effect"
import type { Document } from "@opencode/schema/config"
import { Bus } from "./bus.js"
import { Config } from "./config.js"
import { Job } from "./job.js"
import { Location } from "./location.js"
import { LocationLifecycle } from "./location-lifecycle.js"
import { LocationServiceMap } from "./location-service-map.js"
import { SessionEvent } from "./session/event.js"
import { SessionExecution } from "./session/execution.js"
import { SessionStore } from "./session/store.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

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
      const jobs = yield* Job.Service
      const sessions = yield* SessionStore.Service
      const timeToLive = Duration.fromInputUnsafe(options.timeToLive ?? "60 minutes")
      const entries = new Map<string, { readonly ref: Location.Ref; touchedAt: number }>()
      const key = (ref: Location.Ref) => `${LocationServiceMap.canonical(ref).directory}\0${ref.workspaceID ?? ""}`
      const touch = (ref: Location.Ref) =>
        Effect.sync(() => {
          entries.set(key(ref), { ref, touchedAt: clock.currentTimeMillisUnsafe() })
        })

      // Read across every instance cached at the Location (default and private): any opt-out disables eviction,
      // otherwise keep the longest configured timeout so no instance is swept before its own deadline.
      const idleTimeout = (ref: Location.Ref) =>
        Effect.gen(function* () {
          const contexts = yield* locations.cachedContexts(ref)
          if (contexts.length === 0) return timeToLive
          const timeouts = yield* Effect.forEach(contexts, (context) => {
            const config = Context.getOption(context, Config.Service)
            if (Option.isNone(config)) return Effect.succeed(timeToLive)
            return Effect.map(config.value.entries(), (entries) => {
              const configured = entries.findLast(
                (entry): entry is Document =>
                  entry.type === "document" && entry.info.experimental?.location_idle_timeout !== undefined,
              )
              return configured?.info.experimental?.location_idle_timeout ?? timeToLive
            })
          })
          return timeouts.reduce<false | Duration.Duration>(
            (longest, timeout) =>
              longest === false || timeout === false
                ? false
                : Duration.toMillis(timeout) > Duration.toMillis(longest)
                  ? timeout
                  : longest,
            Duration.zero,
          )
        }).pipe(
          Effect.scoped,
          Effect.catchCause(() => Effect.succeed(timeToLive)),
        )

      // An open terminal or client MCP socket on any cached instance keeps its Location loaded: eviction would end
      // the shell under the user, and the client would reconnect and boot a fresh Location right away.
      const retained = (ref: Location.Ref) =>
        locations.cachedContexts(ref).pipe(
          Effect.map((contexts) =>
            contexts.some((context) =>
              Option.exists(Context.getOption(context, LocationLifecycle.Service), (lifecycle) =>
                lifecycle.isRetained(),
              ),
            ),
          ),
          Effect.scoped,
        )

      const unsubscribe = yield* bus.listen((event) => {
        if (!isSessionEvent(event) || !event.location) return Effect.void
        const location = LocationServiceMap.canonical(event.location)
        return locations.has(location).pipe(Effect.flatMap((active) => (active ? touch(location) : Effect.void)))
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* Effect.gen(function* () {
        yield* Effect.sleep(options.sweepInterval ?? "1 minute")
        const refs = yield* locations.keys
        const cached = new Set(refs.map(key))
        yield* Effect.forEach(refs, (ref) => (entries.has(key(ref)) ? Effect.void : touch(ref)), { discard: true })
        for (const id of entries.keys()) {
          if (!cached.has(id)) entries.delete(id)
        }
        const now = clock.currentTimeMillisUnsafe()
        const expired = yield* Effect.filter(Array.from(entries.values()), (entry) =>
          idleTimeout(entry.ref).pipe(
            Effect.map((timeout) => timeout !== false && entry.touchedAt + Duration.toMillis(timeout) <= now),
          ),
        )
        if (expired.length === 0) return
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
          expired,
          (entry) =>
            Effect.gen(function* () {
              if (occupied.has(key(entry.ref)) || (yield* retained(entry.ref))) return yield* touch(entry.ref)
              entries.delete(key(entry.ref))
              yield* Effect.logInfo("location services evicted", {
                directory: entry.ref.directory,
                workspaceID: entry.ref.workspaceID,
              })
              yield* locations.invalidate(entry.ref)
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
