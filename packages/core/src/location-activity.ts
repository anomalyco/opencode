export * as LocationActivity from "./location-activity.js"

import { Context, Duration, Effect, Layer, RcMap, Schema } from "effect"
import { Event } from "@opencode/schema/event"
import { Permission } from "@opencode/schema/permission"
import { Form } from "@opencode/schema/form"
import { Bus } from "./bus.js"
import { Inactivity } from "./inactivity.js"
import { LocationServiceMap } from "./location-service-map.js"
import { SessionEvent } from "./session/event.js"
import { SessionExecution } from "./session/execution.js"
import { SessionStore } from "./session/store.js"
import { SessionSchema } from "./session/schema.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

const isSessionEvent = (event: Event.Payload): event is SessionEvent.Event =>
  Object.hasOwn(SessionEvent.All.cases, event.type)

/** Observe Session progress and expire process-local execution separately from shared Location resources. */
export class Service extends Context.Service<Service, {}>()("@opencode/LocationActivity") {}

/** Run the inactivity sweep; shorter intervals are also used by isolated lifecycle fixtures. */
export function layer(options: { readonly timeToLive?: Duration.Input; readonly sweepInterval?: Duration.Input } = {}) {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const locations = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const sessions = yield* SessionStore.Service
      const inactivity = yield* Inactivity.Service
      const timeToLive = Duration.toMillis(options.timeToLive ?? "60 minutes")
      const unsubscribe = yield* bus.listen((event) =>
        Effect.gen(function* () {
          if (event.type === SessionEvent.Viewed.type) return
          if (
            isSessionEvent(event) &&
            event.type === SessionEvent.Execution.Interrupted.type &&
            event.data.reason === "inactivity"
          )
            return
          const sessionID = isSessionEvent(event)
            ? event.data.sessionID
            : Schema.is(Permission.Event.Asked)(event)
              ? event.data.sessionID
              : Schema.is(Permission.Event.Replied)(event)
                ? event.data.sessionID
                : Schema.is(Form.Event.Created)(event)
                  ? event.data.form.sessionID
                  : Schema.is(Form.Event.Replied)(event) || Schema.is(Form.Event.Cancelled)(event)
                    ? event.data.sessionID
                    : undefined
          if (!Schema.is(SessionSchema.ID)(sessionID)) return
          const location = event.location ?? (yield* sessions.get(sessionID))?.location
          yield* inactivity.touch({ sessionID, ...(location ? { location } : {}) })
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* Effect.gen(function* () {
        yield* Effect.sleep(options.sweepInterval ?? "1 minute")
        const expired = yield* inactivity.expired({
          sessions: yield* execution.active,
          locations: Array.from(yield* RcMap.keys(locations.rcMap)),
          timeToLive,
        })
        yield* Effect.forEach(expired.sessions, (id) => execution.interrupt(id, { reason: "inactivity" }), {
          discard: true,
          concurrency: "unbounded",
        })
        // Expiring one execution never shuts down a graph still owned by another execution or process.
        for (const ref of expired.locations) {
          const remaining = yield* Effect.forEach(yield* execution.active, (id) => sessions.get(id))
          if (
            remaining.some(
              (session) =>
                session &&
                session.location.directory === ref.directory &&
                session.location.workspaceID === ref.workspaceID,
            )
          )
            continue
          const current = yield* inactivity.expired({
            sessions: yield* execution.active,
            locations: Array.from(yield* RcMap.keys(locations.rcMap)),
            timeToLive,
          })
          if (
            !current.locations.some(
              (location) => location.directory === ref.directory && location.workspaceID === ref.workspaceID,
            )
          )
            continue
          yield* Effect.logInfo("location services evicted", { directory: ref.directory, workspaceID: ref.workspaceID })
          yield* locations.invalidate(ref)
        }
      }).pipe(Effect.forever, Effect.forkScoped)
      return Service.of({})
    }),
  )
}

/** Process-global observation and cleanup, using Session-owned work accounting. */
export const node = makeGlobalNode({
  service: Service,
  layer: layer(),
  deps: [Bus.node, LocationServiceMap.node, SessionExecution.node, SessionStore.node, Inactivity.node],
})
