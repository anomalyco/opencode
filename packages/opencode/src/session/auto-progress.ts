import { Effect, Stream, Ref, HashSet, Context, Layer, Array as A } from "effect"
import { Bus } from "@/bus"
import { Todo } from "@/session/todo"
import { SessionID } from "@/session/schema"
import { InstanceState } from "@/effect/instance-state"

type Payload = { type: "todo.updated"; properties: { sessionID: string; todos: Todo.Info[] } }

type State = {
  ref: Ref.Ref<HashSet.HashSet<string>>
}

export namespace AutoProgress {
  export interface Interface {
    /** Activate the auto-progress engine for a session. Idempotent. */
    readonly start: (sessionID: SessionID) => Effect.Effect<void>
    /** Deactivate the auto-progress engine for a session. */
    readonly stop: (sessionID: SessionID) => Effect.Effect<void>
    /** Get the engine state for a session: "idle" or "running". */
    readonly status: (sessionID: SessionID) => Effect.Effect<"idle" | "running" | "paused">
    /** Whether the engine is currently active for a session. */
    readonly isActive: (sessionID: SessionID) => Effect.Effect<boolean>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/AutoProgress") {}

  const advance = Effect.fn("AutoProgress.advance")(function* (
    todo: Todo.Interface,
    bus: Bus.Interface,
    sid: SessionID,
  ) {
    const all = yield* todo.get(sid)

    // Find L1 in_progress — check if children are all done
    const head = all.find((t) => t.level === 0 && t.status === "in_progress")
    if (head) {
      const kids = all.filter((t) => t.level === 1 && t.parent_id === head.id && t.status !== "cancelled")
      if (kids.length > 0 && kids.every((t) => t.status === "completed")) {
        yield* todo.patchStatus({ sessionID: sid, id: head.id!, status: "completed" })
        yield* bus.publish(Todo.Event.Progressed, {
          sessionID: sid,
          from: "in_progress",
          to: "completed",
          reason: "auto",
        })
      }
      // If L1 is in_progress but not all kids done, do nothing — wait for kids to finish
      return
    }

    // No L1 in_progress — find first pending L1
    const next = all.find((t) => t.level === 0 && t.status === "pending")
    if (!next) return // engine stays idle

    // Start the L1
    yield* todo.patchStatus({ sessionID: sid, id: next.id!, status: "in_progress" })
    yield* bus.publish(Todo.Event.Progressed, {
      sessionID: sid,
      from: "pending",
      to: "in_progress",
      reason: "auto",
    })

    // Start all pending L2 children in parallel
    const kids = all.filter((t) => t.level === 1 && t.parent_id === next.id && t.status === "pending")
    if (kids.length > 0) {
      yield* Effect.all(
        kids.map((k) =>
          Effect.gen(function* () {
            yield* todo.patchStatus({ sessionID: sid, id: k.id!, status: "in_progress" })
            yield* bus.publish(Todo.Event.Progressed, {
              sessionID: sid,
              from: "pending",
              to: "in_progress",
              reason: "auto",
            })
          }),
        ),
        { concurrency: "unbounded" },
      )
    }
  })

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const todo = yield* Todo.Service

      const state = yield* InstanceState.make<State>(
        Effect.fn("AutoProgress.state")(function* (_ctx) {
          const ref = yield* Ref.make(HashSet.empty<string>())

          // Background stream consumer for Todo.Updated events
          yield* bus.subscribe(Todo.Event.Updated).pipe(
            Stream.tap((ev: Payload) =>
              Effect.gen(function* () {
                const sid = ev.properties.sessionID
                const set = yield* Ref.get(ref)
                if (!HashSet.has(set, sid)) return
                yield* advance(todo, bus, sid as SessionID)
              }),
            ),
            Stream.runDrain,
            Effect.forkScoped,
          )

          return { ref }
        }),
      )

      const start = Effect.fn("AutoProgress.start")(function* (sid: SessionID) {
        const s = yield* InstanceState.get(state)
        const existed = yield* Ref.modify(s.ref, (set) => {
          if (HashSet.has(set, sid)) return [true, set]
          return [false, HashSet.add(set, sid)]
        })
        if (!existed) yield* advance(todo, bus, sid)
      })

      const stop = Effect.fn("AutoProgress.stop")(function* (sid: SessionID) {
        const s = yield* InstanceState.get(state)
        yield* Ref.update(s.ref, (set) => HashSet.remove(set, sid))
      })

      const status = Effect.fn("AutoProgress.status")(function* (sid: SessionID) {
        const s = yield* InstanceState.get(state)
        const set = yield* Ref.get(s.ref)
        return HashSet.has(set, sid) ? ("running" as const) : ("idle" as const)
      })

      const isActive = Effect.fn("AutoProgress.isActive")(function* (sid: SessionID) {
        const s = yield* InstanceState.get(state)
        const set = yield* Ref.get(s.ref)
        return HashSet.has(set, sid)
      })

      return Service.of({ start, stop, status, isActive })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Todo.defaultLayer))
}
