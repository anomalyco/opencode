export * as LocationActivity from "./location-activity.js"

import { Clock, Context, Duration, Effect, Layer, RcMap, Schema } from "effect"
import { Event } from "@opencode/schema/event"
import { Permission } from "@opencode/schema/permission"
import { Form } from "@opencode/schema/form"
import { Bus } from "./bus.js"
import { Job } from "./job.js"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"
import { SessionEvent } from "./session/event.js"
import { SessionExecution } from "./session/execution.js"
import { SessionStore } from "./session/store.js"
import { SessionSchema } from "./session/schema.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

const isSessionEvent = (event: Event.Payload): event is SessionEvent.Event =>
  Object.hasOwn(SessionEvent.All.cases, event.type)

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
      const timeToLive = Duration.toMillis(options.timeToLive ?? "60 minutes")
      const entries = new Map<string, { readonly ref: Location.Ref; expiresAt: number }>()
      const progress = new Map<SessionSchema.ID, number>()
      const parents = new Map<SessionSchema.ID, SessionSchema.ID | null>()
      const waits = new Map<SessionSchema.ID, Map<string, number>>()
      const trackWait = (sessionID: SessionSchema.ID, id: string) => {
        if (!progress.has(sessionID)) return
        const pending = waits.get(sessionID) ?? new Map()
        pending.set(id, clock.currentTimeMillisUnsafe() + timeToLive)
        waits.set(sessionID, pending)
      }
      const clearWait = (sessionID: SessionSchema.ID, id: string) => {
        const pending = waits.get(sessionID)
        pending?.delete(id)
        if (pending?.size === 0) waits.delete(sessionID)
        if (progress.has(sessionID)) progress.set(sessionID, clock.currentTimeMillisUnsafe() + timeToLive)
      }
      const key = (ref: Location.Ref) => `${LocationServiceMap.canonical(ref).directory}\0${ref.workspaceID ?? ""}`
      const touch = (ref: Location.Ref) =>
        Effect.sync(() => {
          entries.set(key(ref), { ref, expiresAt: clock.currentTimeMillisUnsafe() + timeToLive })
        })

      const unsubscribe = yield* bus.listen((event) =>
        Effect.gen(function* () {
          if (event.type === Permission.Event.Asked.type && Schema.is(Permission.Event.Asked)(event)) {
            trackWait(event.data.sessionID, event.data.id)
            return
          }
          if (event.type === Permission.Event.Replied.type && Schema.is(Permission.Event.Replied)(event)) {
            clearWait(event.data.sessionID, event.data.requestID)
            return
          }
          if (event.type === Form.Event.Created.type && Schema.is(Form.Event.Created)(event)) {
            const sessionID = event.data.form.sessionID
            if (Schema.is(SessionSchema.ID)(sessionID)) trackWait(sessionID, event.data.form.id)
            return
          }
          if (
            (event.type === Form.Event.Replied.type && Schema.is(Form.Event.Replied)(event)) ||
            (event.type === Form.Event.Cancelled.type && Schema.is(Form.Event.Cancelled)(event))
          ) {
            const sessionID = event.data.sessionID
            if (Schema.is(SessionSchema.ID)(sessionID)) clearWait(sessionID, event.data.id)
            return
          }
          if (!isSessionEvent(event)) return
          const sessionID = event.data.sessionID
          if (event.type !== SessionEvent.Viewed.type) {
            if (event.type === SessionEvent.Execution.Started.type || progress.has(sessionID))
              progress.set(sessionID, clock.currentTimeMillisUnsafe() + timeToLive)
            // Parentage alone also includes background jobs; only a blocking chain carries progress.
            for (
              let child = sessionID, parent = parents.get(child);
              parent;
              child = parent, parent = parents.get(child)
            ) {
              if (!progress.has(parent) || !(yield* jobs.isBlocking({ id: child, sessionID: parent }))) break
              progress.set(parent, clock.currentTimeMillisUnsafe() + timeToLive)
            }
          }
          if (
            event.type === SessionEvent.Execution.Succeeded.type ||
            event.type === SessionEvent.Execution.Failed.type ||
            event.type === SessionEvent.Execution.Interrupted.type
          ) {
            progress.delete(sessionID)
            parents.delete(sessionID)
            waits.delete(sessionID)
          }
          if (!event.durable) return
          const location = event.location
          if (location && (yield* RcMap.has(locations.rcMap, location))) yield* touch(location)
        }),
      )
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
        const activeIDs = yield* execution.active
        yield* Effect.forEach(
          Array.from(activeIDs).filter((id) => !parents.has(id)),
          (id) =>
            Effect.gen(function* () {
              const session = yield* sessions.get(id)
              parents.set(id, session?.parentID ?? null)
              if (
                session?.parentID &&
                progress.has(session.parentID) &&
                (yield* jobs.isBlocking({ id, sessionID: session.parentID }))
              )
                progress.set(session.parentID, now + timeToLive)
            }),
          { discard: true },
        )
        yield* Effect.forEach(
          activeIDs,
          (sessionID) => {
            if (!progress.has(sessionID)) progress.set(sessionID, now + timeToLive)
            const waiting = Array.from(waits.get(sessionID)?.values() ?? []).reduce<number | undefined>(
              (earliest, wait) => (earliest === undefined || wait < earliest ? wait : earliest),
              undefined,
            )
            if ((waiting ?? progress.get(sessionID) ?? 0) > now) return Effect.void
            return execution.interrupt(sessionID, { reason: "inactivity" }).pipe(Effect.asVoid)
          },
          { discard: true, concurrency: "unbounded" },
        )
        const expired = Array.from(entries.values()).filter((entry) => entry.expiresAt <= now)
        if (expired.length === 0) return
        yield* Effect.forEach(
          expired,
          (entry) =>
            Effect.gen(function* () {
              // Invalidation detaches the graph while borrowers still hold it. Active
              // executions retain their Location until they settle, even after its idle deadline.
              const currentIDs = yield* execution.active
              const remaining = yield* Effect.forEach(currentIDs, (sessionID) => sessions.get(sessionID))
              if (remaining.some((session) => session && key(session.location) === key(entry.ref))) return
              if ((entries.get(key(entry.ref))?.expiresAt ?? 0) > now) return
              entries.delete(key(entry.ref))
              yield* Effect.logInfo("location services evicted", {
                directory: entry.ref.directory,
                workspaceID: entry.ref.workspaceID,
              }).pipe(Effect.andThen(locations.invalidate(entry.ref)))
            }),
          { discard: true, concurrency: "unbounded" },
        )
      }).pipe(Effect.forever, Effect.forkScoped)

      return Service.of({})
    }),
  )
}

export const node = makeGlobalNode({
  service: Service,
  layer: layer(),
  deps: [Bus.node, LocationServiceMap.node, SessionExecution.node, SessionStore.node, Job.node],
})
