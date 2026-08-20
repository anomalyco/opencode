import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import { BackgroundJob } from "@/background/job"
import type { SessionID } from "../schema"
import { SessionPhysical } from "../physical-interrupt"
import { SessionRunState } from "../run-state"
import type { SessionClosurePorts as Ports } from "./ports"

/**
 * Enumerates evidence with exact interrupt capabilities so reusable ids cannot retarget later.
 * It stays downstream to avoid a `SessionClosure -> SessionRunState -> SessionClosure` layer cycle.
 */
export interface Interface extends Ports.DiscoveryCapability {}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionClosureDiscovery") {}

/** Missing or malformed metadata stays absent rather than becoming an invented coordinate. */
const coordinate = (metadata: Record<string, unknown> | undefined, key: string) =>
  typeof metadata?.[key] === "string" ? (metadata[key] as SessionID) : undefined

const text = (metadata: Record<string, unknown> | undefined, key: string) =>
  typeof metadata?.[key] === "string" ? (metadata[key] as string) : undefined

/** The return type keeps the adapter and core signal vocabularies exhaustively aligned. */
const signalled = (result: SessionPhysical.Outcome): Ports.SignalOutcome => result.type

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const runState = yield* SessionRunState.Service
    const background = yield* BackgroundJob.Service
    const physical = yield* SessionPhysical.Service

    return Service.of({
      runners: runState.listActive().pipe(
        Effect.map((entries) =>
          entries.map((entry) => ({
            ...entry,
            // The driver is independent of the target and may adopt an in-flight interrupt.
            interrupt: physical.interruptExact({ type: "session", session: entry.session }).pipe(Effect.map(signalled)),
          })),
        ),
      ),
      jobs: background.listExact().pipe(
        Effect.map((entries) =>
          entries.map((entry) => ({
            job: entry.info.id,
            // Lifetime phase and public status are independent axes.
            state: entry.state,
            status: entry.info.status,
            target: coordinate(entry.info.metadata, "sessionId"),
            owner: coordinate(entry.info.metadata, "parentSessionId"),
            // ToolPart resolution happens after proof, keeping discovery independent of `Session`.
            taskMessage: text(entry.info.metadata, "taskMessageId"),
            taskCall: text(entry.info.metadata, "taskCallId"),
            // The opaque lifetime stays inside the capability and never enters model data.
            interrupt: physical
              .interruptExact({ type: "lifetime", lifetime: entry.lifetime })
              .pipe(Effect.map(signalled)),
          })),
        ),
      ),
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [SessionRunState.node, BackgroundJob.node, SessionPhysical.node],
})

export * as SessionClosureDiscovery from "./discovery"
