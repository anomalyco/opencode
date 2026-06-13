// `decision.recorded` is an ephemeral typed event (no `sync`), mirroring `permission.v2.asked`. A
// human-readable ADR under `docs/adr/` stays the source of truth; this makes architectural decisions
// queryable through the native event system. Auto-emission from the agent's ADR-writing flow is a
// follow-up — tools cannot obtain `EventV2.Service` today, so a caller in core/session must emit it.
import { Effect, Schema } from "effect"
import { EventV2 } from "./event"

export namespace Decision {
  export const Recorded = EventV2.define({
    type: "decision.recorded",
    schema: {
      context: Schema.String,
      decision: Schema.String,
      rationale: Schema.String,
      alternatives: Schema.optional(Schema.String),
      impact: Schema.String,
      agent: Schema.String,
    },
  })

  export type Input = (typeof Recorded.Type)["data"]

  // Publish a decision event. Requires `EventV2.Service` in context. The ADR markdown is written by
  // the caller (agent-authored today); this only adds the queryable event.
  export const record = (input: Input) =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      return yield* events.publish(Recorded, input)
    })
}
