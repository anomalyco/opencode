import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import type { MessageID, PartID, SessionID } from "./schema"
import type { Session } from "./session"
import { SessionToolPartPermit } from "./toolpart-permit"

// `terminalizeExact` is used by the execution finalizing a part it created.
// `terminalizePermitted` is used by an independent observer and requires a single-use,
// coordinate-exact permit. Keep their writes separate: one writer would erase the distinction
// between cancellation-owned and permit-owned authority.
// Closure callers must wait for quiescence, or completion could win between the read and write
// and then be overwritten as cancelled.
export type Coordinate = {
  readonly session: SessionID
  readonly message: MessageID
  readonly part: PartID
}

export type Observation =
  | { readonly type: "preserved"; readonly outcome: "completed" | "error" }
  | { readonly type: "terminalized"; readonly outcome: "cancelled" }
  | { readonly type: "unavailable"; readonly reason: "no_part" | "not_a_tool_part" }

export type Terminal = (observed: SessionV1.ToolStatePending | SessionV1.ToolStateRunning) => SessionV1.ToolStateError

// This narrows reach but does not grant authority; permitted writes also require a permit.
export type Reach = Pick<Session.Interface, "getPart" | "updatePart">

type Probe =
  | { readonly type: "settled"; readonly observation: Observation }
  | {
      readonly type: "active"
      readonly part: SessionV1.ToolPart
      readonly state: SessionV1.ToolStatePending | SessionV1.ToolStateRunning
    }

const observe = Effect.fn("SessionToolPart.observe")(function* (input: {
  readonly session: Reach
  readonly target: Coordinate
}) {
  const found = yield* input.session.getPart({
    sessionID: input.target.session,
    messageID: input.target.message,
    partID: input.target.part,
  })
  if (!found) return { type: "settled", observation: { type: "unavailable", reason: "no_part" } } satisfies Probe
  if (found.type !== "tool")
    return { type: "settled", observation: { type: "unavailable", reason: "not_a_tool_part" } } satisfies Probe

  // Read the authoritative row rather than a caller-held part, which may lag after an immutable
  // replacement. Once completion or error wins, preserve that row and do not invoke the
  // cancellation payload builder.
  if (found.state.status === "completed")
    return { type: "settled", observation: { type: "preserved", outcome: "completed" } } satisfies Probe
  if (found.state.status === "error")
    return { type: "settled", observation: { type: "preserved", outcome: "error" } } satisfies Probe
  return { type: "active", part: found, state: found.state } satisfies Probe
})

export const terminalizeExact = Effect.fn("SessionToolPart.terminalizeExact")(function* (input: {
  readonly session: Reach
  readonly target: Coordinate
  readonly terminal: Terminal
}) {
  const probe = yield* observe({ session: input.session, target: input.target })
  if (probe.type === "settled") return probe.observation

  yield* input.session.updatePart({ ...probe.part, state: input.terminal(probe.state) } satisfies SessionV1.ToolPart)
  return { type: "terminalized", outcome: "cancelled" } satisfies Observation
})

// The permit supplies the coordinate; accepting a separate target would let one permit reach
// arbitrary rows. An unknown permit is a programming error, and consumption occurs before the
// read so no unauthorized row is inspected.
export const terminalizePermitted = Effect.fn("SessionToolPart.terminalizePermitted")(function* (input: {
  readonly session: Reach
  readonly permit: SessionToolPartPermit.Permit
  readonly terminal: Terminal
}) {
  const permits = yield* SessionToolPartPermit.Service
  const binding = yield* permits.consume(input.permit)
  if (!binding)
    return yield* Effect.die(
      new Error(
        "SessionToolPart.terminalizePermitted reached without a live coordinate-exact " +
          "permit. A permit is minted only by the canonical closure operation under the authority " +
          "lock, is single-use, and belongs to the Instance that minted it; an unrecognized one is " +
          "forged, replayed, stale, or raised against a foreign Instance.",
      ),
    )

  const target: Coordinate = { session: binding.session, message: binding.message, part: binding.part }
  const probe = yield* observe({ session: input.session, target })
  if (probe.type === "settled") return probe.observation

  // `observe` is asynchronous, so permit validity can change before the write. `commit` runs the
  // write under the same gate used by revocation, closing that race rather than checking again.
  // Keep this write separate from `terminalizeExact`; they have different authorities.
  const committed = yield* permits.commit(
    binding.holder,
    input.session.updatePart({ ...probe.part, state: input.terminal(probe.state) } satisfies SessionV1.ToolPart),
  )
  if (!committed.committed)
    return yield* Effect.die(
      new Error(
        "SessionToolPart.terminalizePermitted had its grant revoked between the " +
          "authoritative read and the write. The permit was admissible when consumed; the driver " +
          "run that authorized it ended before the transition, so the write is refused.",
      ),
    )
  return { type: "terminalized", outcome: "cancelled" } satisfies Observation
})

export * as SessionToolPart from "./toolpart-closure"
