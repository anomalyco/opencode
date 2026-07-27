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

// Parse the one-word answer of the turn classifier agent into an idle
// verdict. Anything unexpected (reasoning blocks, extra prose, refusals)
// degrades to undefined so callers fall back to the trailing-"?" heuristic.
export function parseIdleVerdict(text: string): "waiting" | "done" | undefined {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
    .trim()
    .toUpperCase()
  if (cleaned.includes("WAITING")) return "waiting"
  if (cleaned.includes("DONE")) return "done"
  return undefined
}

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
  // Register the verdict of the LLM turn classifier for the turn that just
  // completed; the next idle write consumes it instead of the heuristic.
  readonly noteIdleVerdict: (sessionID: SessionID, verdict: "waiting" | "done") => Effect.Effect<void>
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

    // Verdicts from the LLM turn classifier, keyed by session. Consumed by
    // the next idle write, so a stale verdict can never outlive its turn.
    const idleVerdicts = new Map<SessionID, "waiting" | "done">()

    const write = (sessionID: SessionID, status: Info) => {
      if (status.type === "busy") return store.set(sessionID, "working")
      if (status.type === "retry")
        return store.set(sessionID, "retrying", `${status.message} · attempt #${status.attempt}`.slice(0, 120))
      const verdict = idleVerdicts.get(sessionID)
      idleVerdicts.delete(sessionID)
      return store.setIdle(sessionID, { verdict })
    }

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

    const noteIdleVerdict: Interface["noteIdleVerdict"] = Effect.fn("SessionStatus.noteIdleVerdict")(
      function* (sessionID, verdict) {
        idleVerdicts.set(sessionID, verdict)
      },
    )

    return Service.of({ get, list, set, setNeedsInput, syncPersisted, noteIdleVerdict })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [EventV2Bridge.node, SessionStatusStore.node],
})

export * as SessionStatus from "./status"
