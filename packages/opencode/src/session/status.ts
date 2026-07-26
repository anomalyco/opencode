import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"
import { SessionStatusStore } from "@opencode-ai/core/session/status-store"
import { Effect, Layer, Context } from "effect"
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
  // runtime transitions. All writes are fire-and-forget so they never block
  // or fail a turn.
  readonly setNeedsInput: (sessionID: SessionID, detail: string) => Effect.Effect<void>
  readonly syncPersisted: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const store = yield* SessionStatusStore.Service
    const scope = yield* Effect.scope

    const state = yield* InstanceState.make(
      Effect.fn("SessionStatus.state")(() => Effect.succeed(new Map<SessionID, Info>())),
    )

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      return data.get(sessionID) ?? { type: "idle" as const }
    })

    const list = Effect.fn("SessionStatus.list")(function* () {
      return new Map(yield* InstanceState.get(state))
    })

    const persist = (sessionID: SessionID, status: Info) =>
      status.type === "busy"
        ? store.set(sessionID, "working")
        : status.type === "retry"
          ? store.set(sessionID, "retrying", `${status.message} · attempt #${status.attempt}`.slice(0, 120))
          : store.setIdle(sessionID)

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      const data = yield* InstanceState.get(state)
      yield* events.publish(Event.Status, { sessionID, status })
      yield* persist(sessionID, status).pipe(Effect.ignore, Effect.forkIn(scope))
      if (status.type === "idle") {
        yield* events.publish(Event.Idle, { sessionID })
        data.delete(sessionID)
        return
      }
      data.set(sessionID, status)
    })

    const setNeedsInput: Interface["setNeedsInput"] = Effect.fn("SessionStatus.setNeedsInput")(
      function* (sessionID, detail) {
        yield* store.set(sessionID, "needs_input", detail.slice(0, 120)).pipe(Effect.ignore, Effect.forkIn(scope))
      },
    )

    // Restore the persisted status from the runtime map once a pending
    // question or permission is resolved.
    const syncPersisted: Interface["syncPersisted"] = Effect.fn("SessionStatus.syncPersisted")(function* (sessionID) {
      yield* persist(sessionID, yield* get(sessionID)).pipe(Effect.ignore, Effect.forkIn(scope))
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
