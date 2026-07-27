import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"
import { SessionStatusStore } from "@opencode-ai/core/session/status-store"
import { Cause, Effect, Layer, Queue, Context } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"

export const Info = SessionStatusEvent.Info
export type Info = SessionStatusEvent.Info

export const Event = SessionStatusEvent

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Map<SessionID, Info>>
  readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
  // Persisted cross-project status (session_status table) mirrored from the
  // runtime transitions. Writes are queued so they never block or fail a
  // turn, and a single consumer keeps them ordered: without ordering a slow
  // "done" write could land after a newer "working" and show stale state.
  readonly setNeedsInput: (sessionID: SessionID, detail: string) => Effect.Effect<void>
  readonly syncPersisted: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const store = yield* SessionStatusStore.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionStatus.state")(() => Effect.succeed(new Map<SessionID, Info>())),
    )

    // All store writes flow through this queue; one consumer drains it in
    // order and drops failures (interrupts included) without dying.
    const writes = yield* Queue.unbounded<Effect.Effect<void>>()
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(Queue.take(writes), (write) =>
          Effect.catchCauseIf(
            write,
            (cause) => !Cause.hasInterrupts(cause),
            (cause) => Effect.logWarning("session status write dropped", { cause }),
          ),
        ),
      ),
    )

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      return data.get(sessionID) ?? { type: "idle" as const }
    })

    const list = Effect.fn("SessionStatus.list")(function* () {
      return new Map(yield* InstanceState.get(state))
    })

    const write = (sessionID: SessionID, status: Info) =>
      status.type === "busy"
        ? store.set(sessionID, "working")
        : status.type === "retry"
          ? store.set(sessionID, "retrying", `${status.message} · attempt #${status.attempt}`.slice(0, 120))
          : store.setIdle(sessionID)

    const persist = (sessionID: SessionID, status: Info) => Queue.offer(writes, write(sessionID, status))

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      const data = yield* InstanceState.get(state)
      yield* events.publish(Event.Status, { sessionID, status })
      yield* persist(sessionID, status)
      if (status.type === "idle") {
        yield* events.publish(Event.Idle, { sessionID })
        data.delete(sessionID)
        return
      }
      data.set(sessionID, status)
    })

    const setNeedsInput: Interface["setNeedsInput"] = Effect.fn("SessionStatus.setNeedsInput")(
      function* (sessionID, detail) {
        yield* Queue.offer(writes, store.set(sessionID, "needs_input", detail.slice(0, 120)))
      },
    )

    // Restore the persisted status from the runtime map once a pending
    // question or permission is resolved.
    const syncPersisted: Interface["syncPersisted"] = Effect.fn("SessionStatus.syncPersisted")(function* (sessionID) {
      yield* persist(sessionID, yield* get(sessionID))
    })

    return Service.of({ get, list, set, setNeedsInput, syncPersisted })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [EventV2Bridge.node, SessionStatusStore.node],
})

export * as SessionStatus from "./status"
