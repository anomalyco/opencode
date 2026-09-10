import { describe, expect } from "bun:test"
import { Effect, Ref } from "effect"
import { AttachmentCoordinator } from "@/session/attachment/coordinator"
import { AttachmentParticipant } from "@/session/attachment/participant"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { itBounded as it } from "../lib/effect"

/**
 * §18 Gate 8 step 3's adapter, covered directly. It landed with no tests of its own and was
 * exercised only through the driver, where a fake participant stood in for it.
 *
 * WHY A FAKE COORDINATOR IS LEGITIMATE HERE, given this program's rule that a production path
 * differing from the test path is its most productive defect source. The thing that could go wrong
 * with a fixture — the real graph never delivering this module at all, so a test-authored stand-in
 * proves nothing about production — is pinned separately and behaviourally by the G8-01/Finding-3
 * wiring row in `closure-layer.test.ts`, which resolves the REAL `Ports.layer` and asserts the real
 * participant arrives. That row establishes the wiring; these rows establish the behaviour. Neither
 * substitutes for the other.
 */
const ROOT = "ses_participant_root"
const CHILD = "ses_participant_child"
const GRANDCHILD = "ses_participant_grandchild"
/** A Session with a live attachment scope that core never proved and never hands in. */
const UNPROVEN = "ses_participant_unproven"

/**
 * The scope reports a DIFFERENT Session than the key it was located by, deliberately.
 *
 * `discover` must name core's edge child, and the extended `Scope` also carries its own `sessionID`,
 * so "name the subject core proved" and "name the scope's own Session" are two distinct
 * implementations that agree on every ordinary fixture. Making them disagree here is what turns the
 * subset-selection property into an assertion instead of an inspection.
 */
const SCOPE_REPORTS = "ses_participant_scope_self_report"

const refs = new Map<string, Ports.ParticipantFenceRef>()
const fenceRef = (sessionID: string) => {
  const existing = refs.get(sessionID)
  if (existing) return existing
  const created = Object.freeze(Object.create(null)) as Ports.ParticipantFenceRef
  refs.set(sessionID, created)
  return created
}

const wiring = (located: readonly string[]) =>
  Effect.gen(function* () {
    const cancellations = yield* Ref.make<readonly string[]>([])
    const fences = yield* Ref.make<readonly { readonly session: string; readonly ref: Ports.ParticipantFenceRef }[]>([])
    const scopeFor = (sessionID: string) =>
      ({
        id: `scope_${sessionID}`,
        sessionID: SCOPE_REPORTS,
        // Deliberately IDENTICAL live projections for opposite retained fence truth. No function of
        // candidate, everAttached, needsWake or counts can distinguish the two subjects.
        current: () => ({
          scopeID: `scope_${sessionID}`,
          epoch: 0,
          attached: 99,
          undelivered: 99,
          everAttached: true,
          candidate: false,
          failed: false,
          cancelled: false,
        }),
        needsWake: () => true,
        claimCancellation: () => Ref.update(cancellations, (current) => [...current, sessionID]),
      }) as unknown as AttachmentCoordinator.Scope
    const coordinator = {
      open: () => Effect.die("participant unit rows never open a scope"),
      locate: (sessionID: string) => Effect.succeed(located.includes(sessionID) ? scopeFor(sessionID) : undefined),
      captureFence: (sessionID: string, ref: Ports.ParticipantFenceRef) =>
        located.includes(sessionID)
          ? Ref.update(fences, (current) => [...current, { session: sessionID, ref }]).pipe(Effect.as(true))
          : Effect.succeed(false),
      claimCancellationAtFence: (sessionID: string, ref: Ports.ParticipantFenceRef) =>
        located.includes(sessionID) && ref === fenceRef(sessionID)
          ? Ref.update(cancellations, (current) => [...current, sessionID]).pipe(Effect.as(true))
          : Effect.succeed(false),
      claim: () => Effect.die("participant unit rows never claim through the coordinator"),
      settleClaim: () => Effect.void,
      awaitClaim: () => Effect.succeed(false),
    } as unknown as AttachmentCoordinator.Interface
    return {
      participant: AttachmentParticipant.make(coordinator),
      cancellations,
      fences,
      current: (sessionID: string) => scopeFor(sessionID).current(),
    }
  })

const call = (kind: Ports.ParticipantKind, payload: unknown, participantRevision = 0n): Ports.ParticipantCall => ({
  kind,
  participant: AttachmentParticipant.ID,
  operation: Model.id("operation", "op_participant_unit"),
  repair: Model.id("repair", "rep_participant_unit"),
  operationRevision: 1n,
  participantRevision,
  payload,
})

const BOTH_EDGES = {
  edges: [
    { owner: ROOT, child: CHILD },
    { owner: CHILD, child: GRANDCHILD },
  ],
}

describe("closure.participant CP-021 adapter", () => {
  it.live("§14.2 discover: a subset selection over core's proven edges, never a widening", () =>
    Effect.gen(function* () {
      // The coordinator holds a scope for a Session core never proved and never hands in. If any
      // path existed from "scopes I know about" to "subjects I report", UNPROVEN would appear.
      const { participant } = yield* wiring([CHILD, GRANDCHILD, UNPROVEN])
      const result = yield* participant.discover(call("discover", BOTH_EDGES))

      expect(result.result).toBe("success")
      expect(result.value).toEqual([
        { type: "participant_edge", subject: CHILD, owner: ROOT },
        { type: "participant_edge", subject: GRANDCHILD, owner: CHILD },
      ])

      // Stated as its own assertion rather than left implicit in the deep-equal above: the module
      // has no source for an unproven subject, so it cannot name one.
      expect(JSON.stringify(result.value)).not.toContain(UNPROVEN)
      // And the subject is core's edge child, not the scope's self-reported Session.
      expect(JSON.stringify(result.value)).not.toContain(SCOPE_REPORTS)
    }),
  )

  it.live("§14.2 discover: owner is echoed from core's edge rather than derived", () =>
    Effect.gen(function* () {
      const { participant } = yield* wiring([GRANDCHILD])
      // An owner core would never derive from CP-021 state: the module must echo it verbatim,
      // which is why it never needs CP-021's scope-to-Session mapping.
      const result = yield* participant.discover(call("discover", { edges: [{ owner: ROOT, child: GRANDCHILD }] }))
      expect(result.value).toEqual([{ type: "participant_edge", subject: GRANDCHILD, owner: ROOT }])
    }),
  )

  it.live("§14.2 discover: an edge whose child has no scope is uncovered, not refused", () =>
    Effect.gen(function* () {
      const { participant } = yield* wiring([GRANDCHILD])
      const result = yield* participant.discover(call("discover", BOTH_EDGES))
      // Coverage is a per-edge fact. CHILD is simply not covered; the exchange still succeeds.
      expect(result.result).toBe("success")
      expect(result.value).toEqual([{ type: "participant_edge", subject: GRANDCHILD, owner: CHILD }])
    }),
  )

  it.live("§14.2 claim: captures fence truth for exactly the named subjects without local cancellation", () =>
    Effect.gen(function* () {
      const { participant, cancellations, fences } = yield* wiring([CHILD])
      const result = yield* participant.claim(
        call("claim", {
          fences: [
            { subject: CHILD, ref: fenceRef(CHILD) },
            { subject: UNPROVEN, ref: fenceRef(UNPROVEN) },
          ],
        }),
      )

      // UNPROVEN has no scope here, so it is skipped rather than fabricated.
      expect(yield* Ref.get(fences)).toEqual([{ session: CHILD, ref: fenceRef(CHILD) }])
      // Capture is distinct from ordinary Task interruption and deliberately non-destructive.
      expect(yield* Ref.get(cancellations)).toEqual([])
      // The reply says only that immutable evidence is HELD; destructive cancellation follows core's
      // physical signal through the Task finalizer or the later participant-cancel receipt.
      expect(result.value).toEqual([{ type: "participant_claim", subject: CHILD, claim: "held" }])
    }),
  )

  it.live("§14.2 cancel: a receipt echoing core's own folded outcome, never one this module invents", () =>
    Effect.gen(function* () {
      const { participant, cancellations } = yield* wiring([CHILD])
      // `in_progress` is the WEAKEST fold outcome and one no participant would choose to report if
      // it were inventing an answer, so echoing it exactly is the discriminating case.
      const result = yield* participant.cancel(
        call("cancel", { cancels: [{ subject: CHILD, outcome: "in_progress", ref: fenceRef(CHILD) }] }),
      )
      expect(yield* Ref.get(cancellations)).toEqual([CHILD])
      expect(result.value).toEqual([{ type: "participant_cancel", subject: CHILD, outcome: "in_progress" }])
    }),
  )

  it.live("§14.5 observe: emits no record fact after provider-proof retirement", () =>
    Effect.gen(function* () {
      const { participant, current } = yield* wiring([CHILD, GRANDCHILD, UNPROVEN])
      expect({ ...current(CHILD), scopeID: "same" }).toEqual({ ...current(GRANDCHILD), scopeID: "same" })
      const result = yield* participant.observe(
        call("observe", {
          fences: [
            { subject: CHILD, ref: fenceRef(CHILD) },
            { subject: GRANDCHILD, ref: fenceRef(GRANDCHILD) },
          ],
        }),
      )
      expect(result.result).toBe("success")
      expect(result.value).toEqual([])
    }),
  )

  it.live("§14.2/§14.5: fence payload parsing is exact and never reflects over extra authority", () =>
    Effect.gen(function* () {
      const { participant, fences } = yield* wiring([CHILD, GRANDCHILD])
      const payload = {
        fences: [
          { subject: CHILD, ref: fenceRef(CHILD) },
          { subject: GRANDCHILD, ref: fenceRef(GRANDCHILD), release: () => undefined },
          { subject: GRANDCHILD, ref: "not-an-object" },
          { subject: 7, ref: fenceRef(GRANDCHILD) },
        ],
      }
      const claim = yield* participant.claim(call("claim", payload))
      const observe = yield* participant.observe(call("observe", payload, claim.revision))

      expect(yield* Ref.get(fences)).toEqual([{ session: CHILD, ref: fenceRef(CHILD) }])
      expect(claim.value).toEqual([{ type: "participant_claim", subject: CHILD, claim: "held" }])
      expect(observe.value).toEqual([])
    }),
  )

  it.live("§14.2: every exchange advances the participant revision, including one that found nothing", () =>
    Effect.gen(function* () {
      const { participant } = yield* wiring([CHILD])
      // An exchange IS a state change from core's perspective, whatever this module found.
      // Reporting an unchanged revision would assert the stronger claim that nothing moved.
      const first = yield* participant.discover(call("discover", BOTH_EDGES))
      const second = yield* participant.claim(call("claim", { fences: [{ subject: CHILD, ref: fenceRef(CHILD) }] }))
      const third = yield* participant.cancel(
        call("cancel", { cancels: [{ subject: CHILD, outcome: "adopted", ref: fenceRef(CHILD) }] }),
      )
      const fourth = yield* participant.observe(call("observe", {}))
      expect([first.revision, second.revision, third.revision, fourth.revision]).toEqual([1n, 2n, 3n, 4n])
    }),
  )

  it.live("§14.2: a malformed payload entry is ignored rather than coerced into a subject", () =>
    Effect.gen(function* () {
      const { participant } = yield* wiring([CHILD, GRANDCHILD])
      const result = yield* participant.discover(
        call("discover", {
          edges: [{ owner: ROOT, child: CHILD }, { owner: 7, child: GRANDCHILD }, { child: GRANDCHILD }, null],
        }),
      )
      // Only the well-formed edge survives. A coerced `7` would have produced an owner core never
      // proved, which is the widening the subset selection exists to prevent.
      expect(result.value).toEqual([{ type: "participant_edge", subject: CHILD, owner: ROOT }])
    }),
  )

  it.live("G8-08: the seam carries no core-fence or record capability, so those authorities are unreachable", () =>
    /**
     * §18's G8-08 — "the participant writes zero closure records and cannot release a core fence" —
     * asserted at its MECHANISM rather than by enumerating things this module does not do.
     *
     * Listing forbidden calls is the DETECTABLE shape, and Gate 7 spent four rounds establishing
     * that a detector at an authority boundary gets evaded by a form it did not anticipate. What
     * actually makes G8-08 true is narrower and structural: the seam carries no CORE-FENCE or
     * RECORD-WRITER authority. Core hands a participant seven top-level fields and receives three
     * back, none of them a core mutator. Claim/cancel payloads do carry one frozen, fieldless
     * fence-generation identity: together with the coordinator constructor dependency, it is an
     * intentional bearer capability for exact LOCAL attachment cancellation. It has no methods,
     * values, or core API that could release a core fence or write a closure record.
     *
     * BOTH DIRECTIONS ARE PINNED, and the outbound one is not redundant. G8-08 has two halves and
     * they fail differently: an inbound CORE capability would let this module write or release,
     * while an outbound one would let it instruct core to do so — the same asymmetry that makes
     * `participant_cancel` a receipt rather than evidence. `Exactly` is bidirectional so a key
     * REMOVED is a compile error too, which keeps the guard honest when the surface shrinks rather
     * than only when it grows.
     *
     * GUARD KIND: compile error. Adding `control`, `record`, `fence` or any other member to either
     * type makes the annotated `true` unassignable to `false` and fails `tsgo --noEmit`. That is
     * deliberate after this gate's D3 finding, where a source-SHAPE assertion guarding the same
     * class of rule broke silently the moment the artifact it named changed.
     *
     * WHAT THIS GUARD REACHES, stated exactly, because "data in both directions" reads as a
     * stronger claim than the key check makes. `ParticipantCall.payload` and
     * `ParticipantResult.value` are typed `unknown` (`ports.ts`), so this proves the TOP-LEVEL
     * channel shape - which members exist - and NOT recursively that every nested value is plain
     * data. A capability smuggled inside `payload` would not fail this assertion.
     *
     * There is no live CORE-authority path, and the reason is a mechanism rather than an absence of
     * imagination: core constructs the one opaque ref from its current fence generation; the
     * consumer exactly parses `{ subject, ref }` and may use it only through the separately injected
     * coordinator to cancel the exact local attachment Scope captured at claim. Unexpected nested
     * members are inert — never invoked or reflected over. The bidirectional key guard closes the
     * channel's top-level shape; exact parsing and the fieldless ref bound the one local capability.
     */
    Effect.gen(function* () {
      type Exactly<A, B> = [Exclude<A, B>] extends [never] ? ([Exclude<B, A>] extends [never] ? true : false) : false

      // Everything core hands a participant. Identity, coordinates, revisions, payload — all data.
      type CallKeys =
        | "kind"
        | "participant"
        | "operation"
        | "repair"
        | "operationRevision"
        | "participantRevision"
        | "payload"
      const inboundIsDataOnly: Exactly<keyof Ports.ParticipantCall, CallKeys> = true

      // Everything a participant may hand back: a revision, an outcome, and facts.
      type ResultKeys = "revision" | "result" | "value"
      const outboundIsDataOnly: Exactly<keyof Ports.ParticipantResult, ResultKeys> = true

      expect([inboundIsDataOnly, outboundIsDataOnly]).toEqual([true, true])

      // And the module's own surface is exactly the four exchanges plus its identity — no
      // additional method through which core authority could be exercised.
      const { participant } = yield* wiring([CHILD])
      expect(Object.keys(participant).toSorted()).toEqual(["cancel", "claim", "discover", "id", "observe"])
    }),
  )
})
