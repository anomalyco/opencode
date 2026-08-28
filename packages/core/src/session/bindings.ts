export * as SessionBindings from "./bindings.js"

import { Context, Effect, Layer, Schema, Scope } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import type { Instance } from "../instance.js"
import { Location } from "../location.js"
import type { SessionExecution } from "./execution.js"
import { SessionInstance } from "./instance.js"
import { SessionModelTransport } from "./model-transport.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"

export class AlreadyBoundError extends Schema.TaggedError<AlreadyBoundError>()("Session.AlreadyBoundError", {
  sessionID: SessionSchema.ID,
}) {}

export class ClosedError extends Schema.TaggedError<ClosedError>()("Session.ClosedError", {
  sessionID: SessionSchema.ID,
}) {}

export interface Binding {
  readonly check: Effect.Effect<void, ClosedError>
  readonly activate: (context: Context.Context<Instance.Services>) => Effect.Effect<void>
  readonly shutdown: (execution: SessionExecution.Interface) => Effect.Effect<void>
}

export interface Interface {
  readonly reserve: (sessionID: SessionSchema.ID) => Effect.Effect<Binding, AlreadyBoundError, Scope.Scope>
  readonly instances: SessionInstance.Interface
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionBindings") {}

type Entry = {
  readonly ids: Set<SessionSchema.ID>
  context?: Context.Context<Instance.Services>
  closed: boolean
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const entries = new Map<SessionSchema.ID, Entry>()
    // Children use their nearest explicitly bound ancestor. Remember every used
    // child so closing one instance settles its whole execution ownership chain.
    const find = (session: SessionSchema.Info): Effect.Effect<Entry | undefined> =>
      Effect.suspend(() => {
        const entry = entries.get(session.id)
        if (entry) return Effect.succeed(entry)
        if (!session.parentID) return Effect.succeed(undefined)
        return store
          .get(session.parentID)
          .pipe(Effect.flatMap((parent) => (parent ? find(parent) : Effect.succeed(undefined))))
      })
    const selected = Effect.fn("SessionBindings.selected")(function* (session: SessionSchema.Info) {
      const entry = yield* find(session)
      if (!entry || entry.closed || !entry.context)
        return yield* Effect.die(new Error(`Session has no live bound instance: ${session.id}`))
      const location = Context.get(entry.context, Location.Service)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.die(new Error(`Bound Session placement changed: ${session.id}`))
      entry.ids.add(session.id)
      entries.set(session.id, entry)
      return entry.context
    })
    return Service.of({
      reserve: (sessionID) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const session = yield* store.get(sessionID)
            if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
            if (yield* find(session)) return yield* new AlreadyBoundError({ sessionID })
            const entry: Entry = { ids: new Set([sessionID]), closed: false }
            entries.set(sessionID, entry)
            const release = Effect.sync(() => {
              entry.closed = true
              entry.context = undefined
              entry.ids.forEach((id) => {
                if (entries.get(id) === entry) entries.delete(id)
              })
            })
            yield* Effect.addFinalizer(() => release)
            return {
              check: Effect.suspend(() => (entry.closed ? Effect.fail(new ClosedError({ sessionID })) : Effect.void)),
              activate: (context) =>
                Effect.sync(() => {
                  entry.context = context
                }),
              shutdown: (execution) =>
                Effect.sync(() => {
                  entry.closed = true
                }).pipe(Effect.andThen(execution.shutdown(Array.from(entry.ids))), Effect.ensuring(release)),
            }
          }),
        ),
      instances: {
        get: (session) => Layer.effectContext(selected(session)),
        check: (sessionID) =>
          store.get(sessionID).pipe(
            Effect.flatMap((session) =>
              session ? selected(session) : Effect.die(new Error(`Session not found: ${sessionID}`)),
            ),
            Effect.asVoid,
          ),
        closeTransport: (session) =>
          selected(session).pipe(
            Effect.flatMap((context) => Context.get(context, SessionModelTransport.Service).close(session.id)),
          ),
        destination: () =>
          Layer.effect(Location.Service, Effect.die(new Error("Direct Sessions do not support movement"))),
      },
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [SessionStore.node] })

export const instanceNode = makeGlobalNode({
  service: SessionInstance.Service,
  layer: Layer.effect(
    SessionInstance.Service,
    Effect.map(Service, (bindings) => bindings.instances),
  ),
  deps: [node],
})
