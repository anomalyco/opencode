import { Effect } from "effect"
import type { SessionID } from "../schema"
import type { SessionClosureModel as Model } from "../closure/model"
import type { SessionClosurePorts as Ports } from "../closure/ports"
import type { AttachmentCoordinator } from "./coordinator"

// This bridge can be instance-borne because `AttachmentCoordinator.node` has no dependency on
// closure. Constructor injection makes a missing coordinator a wiring error, and its captured scope
// avoids resolving a reusable SessionID during cancellation. Participant facts are claims; the
// closure driver validates their keys, domains, and subject scope.
// Facts remain flat scalars because validation is top-level; nested values could bypass key checks.
// Liveness is represented by core-owned execution leases, not by missing participant facts.
type EdgeFact = {
  readonly type: "participant_edge"
  readonly subject: string
  readonly owner: string
}

type ClaimFact = {
  readonly type: "participant_claim"
  readonly subject: string
  readonly claim: "held"
}

type CancelFact = {
  readonly type: "participant_cancel"
  // A Session is the physical cancellation unit. A reusable job id or invocation sequence would be
  // ABA-unsafe; the opaque fence ref in the private input binds cancellation to the captured scope.
  readonly subject: string
  // A receipt for the outcome established and supplied by core.
  readonly outcome: string
}

type Fact = EdgeFact | ClaimFact | CancelFact

/** An edge already proven by core. */
type EdgeInput = { readonly owner: SessionID; readonly child: SessionID }

const edgeInputs = (payload: unknown): readonly EdgeInput[] => {
  if (typeof payload !== "object" || payload === null) return []
  const edges = (payload as { readonly edges?: unknown }).edges
  if (!Array.isArray(edges)) return []
  return edges.flatMap((item) => {
    if (typeof item !== "object" || item === null) return []
    const edge = item as Record<string, unknown>
    if (typeof edge.owner !== "string" || typeof edge.child !== "string") return []
    return [{ owner: edge.owner as SessionID, child: edge.child as SessionID }]
  })
}

type FenceInput = { readonly subject: SessionID; readonly ref: Ports.ParticipantFenceRef }

const fenceInputs = (payload: unknown): readonly FenceInput[] => {
  if (typeof payload !== "object" || payload === null) return []
  if (Object.keys(payload).toSorted().join(",") !== "fences") return []
  const items = (payload as { readonly fences?: unknown }).fences
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    if (typeof item !== "object" || item === null) return []
    if (Object.keys(item).toSorted().join(",") !== "ref,subject") return []
    const entry = item as Record<string, unknown>
    // Shape validation only, not provenance authentication. Core is the sole production payload
    // constructor; actual identity is established when its object is used as the WeakMap key.
    if (typeof entry.subject !== "string" || typeof entry.ref !== "object" || entry.ref === null) return []
    return [{ subject: entry.subject as SessionID, ref: entry.ref as Ports.ParticipantFenceRef }]
  })
}

// Core supplies subjects it has already proven, claimed, fenced, and signalled.
type CancelInput = {
  readonly subject: SessionID
  readonly outcome: string
  readonly ref: Ports.ParticipantFenceRef
}

const cancelInputs = (payload: unknown): readonly CancelInput[] => {
  if (typeof payload !== "object" || payload === null) return []
  const items = (payload as { readonly cancels?: unknown }).cancels
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    if (typeof item !== "object" || item === null) return []
    if (Object.keys(item).toSorted().join(",") !== "outcome,ref,subject") return []
    const entry = item as Record<string, unknown>
    if (
      typeof entry.subject !== "string" ||
      typeof entry.outcome !== "string" ||
      typeof entry.ref !== "object" ||
      entry.ref === null
    )
      return []
    return [
      {
        subject: entry.subject as SessionID,
        outcome: entry.outcome,
        ref: entry.ref as Ports.ParticipantFenceRef,
      },
    ]
  })
}

export const ID = "participant_task_attachment" as Model.ParticipantID

export const make = (coordinator: AttachmentCoordinator.Interface): Ports.Participant => {
  // Every exchange invalidates the preceding proof even when no attachment fact changed. Only
  // monotonicity matters; revisions are compared within an operation.
  let revision = 0n
  const next = () => {
    revision = revision + 1n
    return revision
  }

  const reply = (facts: readonly Fact[]): Ports.ParticipantResult => ({
    revision: next(),
    result: "success",
    value: facts,
  })

  // Return only supplied edges covered by an attachment scope; this participant cannot widen the
  // proven set.
  const discover = (input: Ports.ParticipantCall) =>
    Effect.gen(function* () {
      const facts: Fact[] = []
      for (const edge of edgeInputs(input.payload)) {
        const scope = yield* coordinator.locate(edge.child)
        if (!scope) continue
        facts.push({ type: "participant_edge", subject: edge.child, owner: edge.owner })
      }
      return reply(facts)
    })

  // Bind the opaque fence ref to the exact live scope before physical signals are dispatched.
  const claim = (input: Ports.ParticipantCall) =>
    Effect.gen(function* () {
      const facts: Fact[] = []
      for (const item of fenceInputs(input.payload)) {
        if (!(yield* coordinator.captureFence(item.subject, item.ref))) continue
        facts.push({ type: "participant_claim", subject: item.subject, claim: "held" })
      }
      return reply(facts)
    })

  // Core owns physical interruption and supplies its outcome. The opaque ref addresses the scope
  // captured during claim, avoiding a fresh lookup by reusable SessionID.
  const cancel = (input: Ports.ParticipantCall) =>
    Effect.gen(function* () {
      const facts: Fact[] = []
      for (const item of cancelInputs(input.payload)) {
        if (!(yield* coordinator.claimCancellationAtFence(item.subject, item.ref))) continue
        facts.push({ type: "participant_cancel", subject: item.subject, outcome: item.outcome })
      }
      return reply(facts)
    })

  /** No observation facts are produced. */
  const observe = (_input: Ports.ParticipantCall) => Effect.succeed(reply([]))

  return { id: ID, discover, claim, cancel, observe }
}

export * as AttachmentParticipant from "./participant"
