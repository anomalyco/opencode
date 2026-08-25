import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Option } from "effect"
import { Session } from "../session"
import { SessionToolPart } from "../toolpart-closure"
import { SessionToolPartPermit } from "../toolpart-permit"
import type { SessionClosurePorts as Ports } from "./ports"

/**
 * Resolves and terminalizes one already-proven Task call. Part IDs are unavailable during discovery,
 * so resolution happens once after proof. It stays downstream of `Session` to avoid a layer cycle.
 */
export interface Interface extends Ports.ToolPartCapability {}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionClosureToolPart") {}

/** Closure records a plain cancellation without inventing execution metadata it did not observe. */
const cancelled: SessionToolPart.Terminal = (observed) => {
  const end = Date.now()
  return {
    status: "error",
    input: observed.input,
    error: "Cancelled",
    // A pending Part has no start time, so cancellation before execution records zero duration.
    time: { start: observed.status === "running" ? observed.time.start : end, end },
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const permits = yield* SessionToolPartPermit.Service

    return Service.of({
      terminalize: (input) =>
        Effect.gen(function* () {
          // Query only the named Session and call; missing state remains `unknown`.
          const message = yield* session
            .findMessage(input.session, (item) => item.info.id === input.message)
            .pipe(Effect.orElseSucceed(() => Option.none()))
          if (Option.isNone(message)) return { outcome: "unknown" as const }

          const part = message.value.parts.find((item) => item.type === "tool" && item.callID === input.call)
          if (!part) return { outcome: "unknown" as const }

          // This is the first point with a Part ID. A revoked or foreign-Instance grant yields no permit.
          const permit = yield* permits.issue(input.grant, {
            session: input.session,
            message: input.message,
            part: part.id,
          })
          if (!permit) return { outcome: "unknown" as const }

          // One authoritative read both decides the write and reports its winner, avoiding a second-read race.
          const observation = yield* SessionToolPart.terminalizePermitted({
            session,
            permit,
            terminal: cancelled,
          }).pipe(
            Effect.provideService(SessionToolPartPermit.Service, permits),
            Effect.catchTag("SessionReservedMetadataError", Effect.die),
          )

          if (observation.type === "unavailable") return { outcome: "unknown" as const }
          return { outcome: observation.outcome, part: part.id }
        }),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Session.node, SessionToolPartPermit.node] })

export * as SessionClosureToolPart from "./toolpart"
