import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { CLOSURE_RECORD_METADATA_KEY } from "@opencode-ai/core/session/closure-record"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option } from "effect"
import { BackgroundJob } from "@/background/job"
import { Workspace } from "@/control-plane/workspace"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceBootstrap as InstanceBootstrapService } from "@/project/bootstrap-service"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { Session as SessionNs } from "@/session/session"
import { SessionSummary } from "@/session/summary"
import { SessionToolPart } from "@/session/toolpart-closure"
import { SessionToolPartPermit } from "@/session/toolpart-permit"
import { SessionAdmission } from "@/session/closure/admission"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosureToolPart } from "@/session/closure/toolpart"
import { SessionMutation } from "@/session/closure/mutation"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
import { MessageID, PartID, SessionID } from "@/session/schema"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { provideInstance } from "../fixture/fixture"
import { unusedJobs } from "../lib/closure"
import { it as itUnbounded, testEffect } from "../lib/effect"
import { scanExportedCalls, scanMemberCalls, scanServiceAcquisitions } from "./closure-update-inventory"
import { AUTHORITIES, REGISTRY, registryKey, type Authority } from "./closure-update-registry"

// CP-023 §7.7 / K107 and K108 — the RUNTIME half of the update-caller classification.
//
// K106 (`closure-update-inventory.test.ts`) proves the classification is complete and cannot rot.
// It is a traceability check and says nothing about behaviour: a caller can be labelled
// `pre_fence_leased_execution` and still write with no live lease. These tests exercise the labels.
//
// WHY THE CATEGORIES ARE TESTED SEPARATELY AND AT DIFFERENT BOUNDARIES. The four §7.7 categories
// make four DIFFERENT claims, so one pipeline cannot state them. `pre_fence_leased_execution` is a
// claim about lease liveness at write time; `proven_non_destructive_update` is a claim about the
// write's SHAPE and holds with no lease at all; `cancellation_owned_terminalization` is a claim
// about a conditional taken while cancellation owns the write (exercised in `prompt.test.ts`, which
// owns the subtask harness); `exact_closure_capability` has no instances yet and is recorded below
// as blocked rather than faked.

const MODEL = { providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-4") }

// ---------------------------------------------------------------------------
// K107 — `pre_fence_leased_execution`
//
// Thirteen registry entries carry this label and they do NOT all rest on the same fact. Two
// distinct sub-claims are load-bearing and both are recorded as open questions the registry keys to
// this slice:
//
//   (a) `processor.ts::cleanup` and `prompt.ts::finalizeInterruptedAssistant` write from BODY
//       FINALIZERS. Their claim is that `admitted`'s retirement sits in an `ensuring` OUTSIDE the
//       body, so a finalizer still runs under a live lease.
//   (b) `processor.ts::completeToolCall`, `processor.ts::updateToolCall` and `tool/plan.ts::execute`
//       write through the EffectBridge. Their claim was never established: `bridge.ts:54-65`
//       captures and re-provides the Effect CONTEXT, and the registry records that a captured
//       context is not proof the LEASE is live.
//
// These are asserted at `admitted`'s own boundary. Driving them through the processor would put a
// second mechanism between the property and the assertion.
//
// GATE-4 RESOLUTION OF (b). The measurement below stood, and the conclusion drawn from it changed:
// the three callers are no longer labelled `pre_fence_leased_execution` on their bridged paths at
// all. They carry `bridged_context_admission`, a category that names the admission mechanism the
// measurement actually proved — a captured context, not a live lease — and leaves each site's
// SAFETY to its own evidence, because the three do not share one. The two `processor.ts` sites are
// safe by a fresh-read status guard; `plan.ts::execute` is safe because it only ever writes freshly
// minted `MessageID`/`PartID` coordinates and overwrites nothing.
//
// (b) IS ESTABLISHED BY COMPOSITION, not by a new fixture, and the composition is stated here so it
// is auditable rather than implied:
//   1. NO LEASE — the bridge test in this block measures it directly: the context survives and the
//      lease does not, ordered `["retire", "bridged-call"]`.
//   2. THE GUARD PRESERVES A RACE WINNER — established at the capability's own boundary by the
//      `exact_closure_capability` block below, whose `preserved` cases prove that a fresh read
//      followed by a conditional write leaves a terminal row's bytes untouched.
//   3. THE GUARD IS ACTUALLY THERE — the one link that was prose, and the one this slice pins, in
//      `bridged_context_admission` below.
// ---------------------------------------------------------------------------

const LEASE = Model.id("lease", "lease_k107")

type Ledger = { readonly timeline: string[] }

const admits: SessionClosure.Interface["acquire"] = () =>
  Effect.succeed({
    type: "admitted",
    lease: LEASE,
    epoch: 0n,
    instance: Model.id("instance", "instance_k107"),
  })

/**
 * A coordinator that records WHEN it is called, not merely THAT it was.
 *
 * The ordering is the whole point for these tests: "the lease was retired" and "the lease was
 * retired after the write" are different claims, and only the second one is the classification.
 */
const timelineInterface = (ledger: Ledger): SessionClosure.Interface => ({
  ...unusedJobs,
  request: () => Effect.die("unused"),
  view: Effect.die("unused"),
  identity: Effect.die("unused"),
  acquire: admits,
  bind: () => Effect.void,
  retire: () => Effect.sync(() => void ledger.timeline.push("retire")),
  reserveMutation: () => Effect.die("unused"),
  activateMutation: () => Effect.void,
  retireMutation: () => Effect.void,
})

describe("K107 pre_fence_leased_execution — the lease is live for the whole admitted body", () => {
  itUnbounded.live("a body finalizer's write happens before the lease retires", () =>
    Effect.gen(function* () {
      const ledger: Ledger = { timeline: [] }
      const closure = timelineInterface(ledger)
      const session = SessionID.make("ses_k107_finalizer")

      yield* SessionAdmission.admitted(closure, { session, origin: "external", source: "test.k107.finalizer" }, () =>
        Effect.sync(() => void ledger.timeline.push("body")).pipe(
          Effect.ensuring(Effect.sync(() => void ledger.timeline.push("finalizer-write"))),
        ),
      )

      // The load-bearing claim behind `processor.ts::cleanup` (installed as `Effect.ensuring` at
      // `:717`) and `prompt.ts::finalizeInterruptedAssistant` (`:1457`, `:1630`). Asserting only
      // "retire happened" would pass even if the finalizer ran after it — which is the defect.
      expect(ledger.timeline).toEqual(["body", "finalizer-write", "retire"])
    }),
  )

  itUnbounded.live("the same holds when the body FAILS, which is the interrupted-assistant shape", () =>
    Effect.gen(function* () {
      const ledger: Ledger = { timeline: [] }
      const closure = timelineInterface(ledger)
      const session = SessionID.make("ses_k107_failing")

      const exit = yield* SessionAdmission.admitted(
        closure,
        { session, origin: "external", source: "test.k107.failing" },
        () =>
          Effect.fail("boom" as const).pipe(
            Effect.ensuring(Effect.sync(() => void ledger.timeline.push("finalizer-write"))),
          ),
      ).pipe(Effect.exit)

      // Positive precondition: the body really failed, so the finalizer below ran on the failure
      // path rather than on an ordinary success this test forgot to break.
      expect(Exit.isFailure(exit)).toBe(true)
      expect(ledger.timeline).toEqual(["finalizer-write", "retire"])
    }),
  )

  itUnbounded.live("a bridged callback keeps the AdmissionContext AFTER its lease has retired", () =>
    Effect.gen(function* () {
      const ledger: Ledger = { timeline: [] }
      const closure = timelineInterface(ledger)
      const session = SessionID.make("ses_k107_bridge")

      const captured = yield* SessionAdmission.admitted(
        closure,
        { session, origin: "external", source: "test.k107.bridge" },
        () =>
          Effect.gen(function* () {
            const bridge = yield* EffectBridge.make()
            // Positive precondition: the context IS resolvable inside the admitted body, so the
            // post-retirement read below is about survival rather than about a service that was
            // ambient all along.
            const inside = yield* Effect.serviceOption(SessionAdmission.Service)
            expect(Option.isSome(inside)).toBe(true)
            return bridge
          }),
      )

      // The lease is settled at this point: `admitted`'s `ensuring` has run.
      expect(ledger.timeline).toEqual(["retire"])

      const after = yield* Effect.promise(() =>
        captured.promise(
          Effect.gen(function* () {
            ledger.timeline.push("bridged-call")
            const found = yield* Effect.serviceOption(SessionAdmission.Service)
            return Option.isSome(found) ? Option.getOrThrow(found).leases : []
          }),
        ),
      )

      // THE ANSWER TO THE REGISTRY'S OPEN QUESTION, and it is not the reassuring one. The bridged
      // call still resolves an `AdmissionContext` naming lease `lease_k107` — but the ordering
      // above proves that lease was retired before the call ran. A captured context is a
      // DESCRIPTION of a lease, not a hold on one, because `bridge.ts:61` re-provides the captured
      // Context while `promise`/`fork` start a NEW ROOT FIBER (`Effect.runPromise`, `:64-67`) that
      // is not a child of the admitted fiber and therefore outlives its `ensuring`.
      //
      // Consequence for the three entries keyed here: `completeToolCall` (`tools.ts:129-131`, at
      // abort time), `updateToolCall` (`tools.ts:71-84`) and `plan.ts::execute` are NOT
      // `pre_fence_leased_execution` on their bridged paths. At Gate 4 those paths were split out
      // into `bridged_context_admission`, which names this measurement as its authority; the leased
      // claim is retained only where it is true, on the in-loop path of the two `processor.ts`
      // sites. `plan.ts::execute` has no in-loop path and so carries the bridged claim alone.
      expect(after).toEqual([LEASE])
      expect(ledger.timeline).toEqual(["retire", "bridged-call"])
    }),
  )
})

// ---------------------------------------------------------------------------
// K107 — `exact_closure_capability`, both named writers landed.
//
// §7.7's last two rows name this category for the closure ToolPart transition and the closure
// Message/Part record writer. The ToolPart writer is exercised below; Gate 5 F1's record writer is
// exercised through the real coordinator, production driver and three-fact generation in
// `closure-driver.test.ts`.
//
// THE FORCING FUNCTION IS KEPT, WITH ITS TRIGGER MOVED. This block used to assert the count was
// zero, so that landing a writer would fail it and demand an exercise rather than let K107 quietly
// keep claiming three-of-four. That is exactly what happened, and the demand was met. Pinning the
// count to the writers that actually exist preserves the mechanism for the half still outstanding:
// when Gate 5's record writer lands, this fails the same way and asks the same thing of it. Prose
// cannot fail; this can.
// ---------------------------------------------------------------------------

describe("K107 exact_closure_capability — both narrow writers are held and exercised", () => {
  test("exactly two callers carry the capability, and they are the named closure writers", () => {
    const counts = new Map<Authority, number>()
    for (const entry of REGISTRY)
      for (const claim of entry.claims) counts.set(claim.authority, (counts.get(claim.authority) ?? 0) + 1)

    // Positive precondition: the registry was actually read and the taxonomy is the one K107 names.
    expect(REGISTRY.length).toBeGreaterThan(15)
    expect(AUTHORITIES).toContain("exact_closure_capability")

    expect(counts.get("pre_fence_leased_execution")).toBeGreaterThan(0)
    expect(counts.get("cancellation_owned_terminalization")).toBeGreaterThan(0)
    expect(counts.get("proven_non_destructive_update")).toBeGreaterThan(0)

    // Two, not merely non-zero. Any third holder is a capability leak; either omission would mean a
    // specified writer disappeared while prose still claimed complete coverage.
    //
    // GATE 7 MOVED THE SECOND HOLDER, and the move is the point rather than a rename. The audit
    // found `terminalizeExact` did not satisfy §7.5: it took a caller-supplied
    // `Pick<Session.Interface, ...>` plus caller-supplied coordinates, carried no operation, no
    // instance and no unforgeable identity, and was called from two ORDINARY finalizers as well as
    // from closure. It is now `cancellation_owned_terminalization` — which is what its two
    // finalizer callers always were — and `terminalizePermitted` is the capability, reachable only
    // with a coordinate-exact permit derived from a coordinator-minted grant.
    expect(counts.get("exact_closure_capability")).toBe(2)
    const holders = REGISTRY.filter((entry) =>
      entry.claims.some((claim) => claim.authority === "exact_closure_capability"),
    ).map(registryKey)
    expect(holders).toEqual(["session/closure/record.ts::write", "session/toolpart-closure.ts::terminalizePermitted"])

    // The ordinary path is still HELD, not merely absent from the capability set. Deleting it would
    // satisfy the assertion above while leaving the two finalizers unclassified.
    const ordinary = REGISTRY.find((entry) => registryKey(entry) === "session/toolpart-closure.ts::terminalizeExact")
    expect(ordinary?.claims.map((claim) => claim.authority)).toEqual(["cancellation_owned_terminalization"])
  })

  test("the two callers that carried the gap are resolved, and no longer defer to a gate", () => {
    // These are the sites §7.7 names. Each used to record that it terminalized BY CONTEXT rather
    // than by capability, and that recorded gap is what made the old zero attributable rather than
    // merely unexplained. Both now route their ToolPart write through the capability, so the gap is
    // closed and the deferral has to go with it: a resolved entry that still named a future gate
    // would report finished work as outstanding, which is the same failure in the other direction.
    const owners = ["session/prompt.ts::handleSubtaskAdmitted", "session/processor.ts::cleanup"]
    for (const owner of owners) {
      const entry = REGISTRY.find((item) => registryKey(item) === owner)
      expect(entry).toBeDefined()
      expect(entry?.uncertain).toBeUndefined()
      expect(entry?.resolveBy).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// K107 — `bridged_context_admission`, the category added at Gate 4.
//
// See the resolution note at the head of this file for why the label changed and how the category's
// claim is composed. This block owns step 3 of that composition: the guard the two `processor.ts`
// entries cite as their SAFETY was, until now, asserted only in registry prose. Prose cannot fail.
// ---------------------------------------------------------------------------

describe("K107 bridged_context_admission — the bridged paths are labelled truthfully and their guard is real", () => {
  test("the three bridged callers carry the category, and no longer defer to a gate", () => {
    // `plan.ts::execute` is deliberately in a different shape from the other two: it has no in-loop
    // caller, so it carries the bridged claim ALONE rather than alongside a leased one. Asserting
    // the claim sets rather than mere membership is what makes that distinction fail if it is lost.
    const claims = (key: string) =>
      REGISTRY.find((entry) => registryKey(entry) === key)?.claims.map((claim) => claim.authority)

    expect(claims("session/processor.ts::completeToolCall")).toEqual([
      "pre_fence_leased_execution",
      "bridged_context_admission",
    ])
    expect(claims("session/processor.ts::updateToolCall")).toEqual([
      "pre_fence_leased_execution",
      "bridged_context_admission",
    ])
    expect(claims("tool/plan.ts::execute")).toEqual(["bridged_context_admission"])

    // The measurement ANSWERED the question, so the deferral has to go with it. A resolved entry
    // still naming a future gate reports finished work as outstanding — the same failure the
    // `exact_closure_capability` block guards in the other direction.
    for (const key of [
      "session/processor.ts::completeToolCall",
      "session/processor.ts::updateToolCall",
      "tool/plan.ts::execute",
    ]) {
      const entry = REGISTRY.find((item) => registryKey(item) === key)
      expect(entry?.uncertain).toBeUndefined()
      expect(entry?.resolveBy).toBeUndefined()
    }
  })

  test("both processor writers fresh-read the row and refuse to write unless it is still running", () => {
    // THE LINK THAT WAS PROSE. The category concedes these writes land with no live lease, so the
    // whole safety argument rests on this guard: a terminalized ToolPart cannot be resurrected
    // because the writer re-reads the authoritative row and returns when it is no longer `running`.
    // If someone deletes the guard, the registry's evidence silently becomes false — and nothing
    // else in this suite notices, because both production callers only ever invoke on a Part they
    // believe active, so the guarded branch never executes there.
    //
    // Asserted against SOURCE rather than by driving the processor, which is this file's standing
    // choice (see the head note): a processor fixture would put a second mechanism between the
    // property and the assertion. Line endings are normalised because these sources are CRLF.
    const text = readFileSync(join(import.meta.dir, "../../src/session/processor.ts"), "utf8").replaceAll("\r\n", "\n")

    // Positive precondition: the file really was read and really does contain the two writers, so a
    // wrong path or an empty read cannot pass the assertions below by vacuous absence.
    expect(text).toContain('Effect.fn("SessionProcessor.completeToolCall")')
    expect(text).toContain('Effect.fn("SessionProcessor.failToolCall")')

    // `completeToolCall` returns bare; `failToolCall` returns `false`. Both are the SAME defence and
    // both are cited by the registry, so both are pinned.
    const guard = (ret: string) =>
      `        const match = yield* readToolCall(toolCallID)\n        if (!match || match.part.state.status !== "running") return${ret}\n`
    expect(text).toContain(guard(""))
    expect(text).toContain(guard(" false"))

    // The read must PRECEDE the guard, which the contiguous match above already forces — the two
    // are asserted as one string because "reads somewhere, guards somewhere" would not be the
    // property.
    //
    // And `updateToolCall` is pinned to its DIFFERENT, weaker shape, positively rather than by a
    // negative that could pass vacuously. Its writer carries only a null check; the status guard
    // lives in the `tools.ts` callback instead. That asymmetry is exactly what its registry evidence
    // claims, so if the two writers ever converge, the evidence stops being true and this fails.
    expect(text).toContain(
      `        const match = yield* readToolCall(toolCallID)\n        if (!match) return undefined\n        const part = yield* session.updatePart(update(match.part))\n`,
    )
  })
})

// ---------------------------------------------------------------------------
// The database-backed harness. Mirrors `closure-revert-mutation.test.ts` so the two files agree on what a
// target Session service with a scripted coordinator looks like.
// ---------------------------------------------------------------------------

type MutationLedger = {
  readonly timeline: string[]
  readonly reserved: { readonly sessions: readonly SessionID[]; readonly kind: string }[]
}

const refuseLedger: MutationLedger = { timeline: [], reserved: [] }
const admitLedger: MutationLedger = { timeline: [], reserved: [] }

const reset = (ledger: MutationLedger) =>
  Effect.sync(() => {
    ledger.timeline.length = 0
    ledger.reserved.length = 0
  })

const recordingClosure = (ledger: MutationLedger, admit: boolean) =>
  Layer.succeed(
    SessionClosure.Service,
    SessionClosure.Service.of({
      ...unusedJobs,
      request: () => Effect.die("unused"),
      view: Effect.die("unused"),
      identity: Effect.die("unused"),
      acquire: () => Effect.die("unused"),
      bind: () => Effect.void,
      retire: () => Effect.void,
      reserveMutation: (input) =>
        Effect.sync(() => {
          ledger.timeline.push("reserve")
          ledger.reserved.push({ sessions: input.sessions, kind: input.kind })
          if (!admit) return { type: "refused" as const, reason: "fenced" as const }
          return { type: "reserved" as const, mutation: Model.id("mutation", `mutation_${ledger.reserved.length}`) }
        }),
      activateMutation: () => Effect.sync(() => void ledger.timeline.push("activate")),
      retireMutation: () => Effect.sync(() => void ledger.timeline.push("retire")),
    }),
  )

const noopBootstrapLayer = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)

/**
 * One graph, with the recording coordinator overriding `SessionClosure` for every dependent.
 *
 * Two properties are load-bearing. The override gives `Session` and `BackgroundJob` the SAME
 * coordinator instance rather than two, and naming `SessionClosure` in the group publishes that same
 * instance to test bodies — so a body driving `SessionMutation.leased` directly records into the
 * recorder the Session service is already using.
 *
 * `InstanceStore` belongs in this group rather than beside it. Compiled separately it hands `Session`
 * a different `Database` than the one the test's own reads resolve, and nothing reports the mismatch
 * — created sessions simply read as absent.
 *
 * §7.5's permit registry is likewise built ONCE and published from this graph, so the test's own,
 * the adapter's, and `terminalizePermitted`'s acquisitions resolve the same per-Instance WeakMaps.
 */
const harness = (closure: Layer.Layer<SessionClosure.Service>) =>
  testEffect(
    AppNodeBuilder.build(
      LayerNode.group([
        InstanceStore.node,
        Project.node,
        SessionNs.node,
        Workspace.node,
        Database.node,
        Storage.node,
        BackgroundJob.node,
        EventV2Bridge.node,
        CrossSpawnSpawner.node,
        SessionClosure.node,
        SessionSummary.node,
        Snapshot.node,
        SessionProjector.node,
        SessionToolPartPermit.node,
      ]),
      [
        [InstanceStore.bootstrapNode, noopBootstrapLayer],
        [SessionClosure.node, closure],
        [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      ],
    ),
  )

const itRefuse = harness(recordingClosure(refuseLedger, false))
const itAdmit = harness(recordingClosure(admitLedger, true))

const seedUser = Effect.fn("test.seedUser")(function* (sessionID: SessionID, text: string) {
  const session = yield* SessionNs.Service
  const info = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user" as const,
    sessionID,
    agent: "default",
    model: MODEL,
    time: { created: Date.now() },
  })
  const part = yield* session.updatePart({
    id: PartID.ascending(),
    messageID: info.id,
    sessionID,
    type: "text",
    text,
  } satisfies SessionV1.TextPart)
  return { info, part }
})

// ---------------------------------------------------------------------------
// K107 — `proven_non_destructive_update`
//
// Two entries carry this label, and for BOTH of them the narrow write shape is the entire
// authority: neither takes a mutation lease, and `summary.ts::summarize` is additionally detached
// from its caller's admission (`prompt.ts:1493`, `processor.ts:539-544` both
// `.pipe(Effect.ignore, Effect.forkIn(scope))`), so there is no lease to fall back on even in
// principle.
//
// Every test below therefore runs under the REFUSING coordinator. That is the instrument, not a
// detail: if either seam ever acquires a lease it will be refused and the call will fail, so
// "succeeded under a coordinator that refuses everything" is a checkable statement of "takes no
// lease". A test under an admitting coordinator could not distinguish the two.
// ---------------------------------------------------------------------------

describe("K107 proven_non_destructive_update — Session.fork writes only to a session that did not exist", () => {
  itRefuse.instance("copies under a refusing coordinator and leaves the source byte-identical", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const source = yield* session.create({ title: "fork-source" })
      yield* seedUser(source.id, "first")
      yield* seedUser(source.id, "second")

      // Positive precondition: there is real content to copy, so "the source is unchanged" below
      // is a statement about preserved rows rather than about an empty transcript.
      const before = yield* session.messages({ sessionID: source.id })
      expect(before).toHaveLength(2)

      const forked = yield* session.fork({ sessionID: source.id })

      // The classification's claim, in three parts.
      // 1. It took no lease at all — under this coordinator any lease would have refused.
      expect(refuseLedger.reserved).toEqual([])
      expect(refuseLedger.timeline).toEqual([])
      // 2. The target is a session that did not exist when the copy began.
      expect(forked.id).not.toBe(source.id)
      // 3. Nothing about the source moved.
      expect(yield* session.messages({ sessionID: source.id })).toEqual(before)
    }),
  )

  itRefuse.instance("remaps every identity coordinate, so no write can land on the source", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const source = yield* session.create({ title: "fork-remap" })
      yield* seedUser(source.id, "first")

      const original = yield* session.messages({ sessionID: source.id })
      const sourceMessageIDs = new Set(original.map((message) => message.info.id))
      const sourcePartIDs = new Set(original.flatMap((message) => message.parts.map((part) => part.id)))
      const forked = yield* session.fork({ sessionID: source.id })
      const copied = yield* session.messages({ sessionID: forked.id })

      // Positive precondition: the copy actually produced rows. Without it the disjointness
      // assertions below hold vacuously over empty sets.
      expect(copied).toHaveLength(1)
      expect(copied[0]!.parts).toHaveLength(1)

      // `session.ts:825-865` mints `MessageID.ascending()` / `PartID.ascending()` and overrides the
      // copied `sessionID`/`id`. If any override were dropped the copy would write onto the source's
      // own coordinates, and the label would be false.
      for (const message of copied) {
        expect(message.info.sessionID).toBe(forked.id)
        expect(sourceMessageIDs.has(message.info.id)).toBe(false)
        for (const part of message.parts) {
          expect(part.sessionID).toBe(forked.id)
          expect(part.messageID).toBe(message.info.id)
          expect(sourcePartIDs.has(part.id)).toBe(false)
        }
      }
    }),
  )
})

describe("K107 proven_non_destructive_update — SessionSummary.summarize changes one bounded field", () => {
  itRefuse.instance("writes the diffs field and nothing else, holding no lease", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "summarize-shape" })
      const target = yield* seedUser(created.id, "target")
      const neighbour = yield* seedUser(created.id, "neighbour")

      const before = yield* session.messages({ sessionID: created.id })
      // Positive precondition: two ordered rows exist and neither carries a summary yet, so the
      // single field observed below actually appeared during this call.
      expect(before.map((item) => item.info.id)).toEqual([target.info.id, neighbour.info.id])
      expect(before[0]!.info.role === "user" ? before[0]!.info.summary?.diffs : undefined).toBeUndefined()

      const summary = yield* SessionSummary.Service
      yield* summary.summarize({ sessionID: created.id, messageID: target.info.id })

      // Takes no mutation lease: `summarize` is detached from its caller's admission, so a lease
      // acquired here would be refused and this call would have failed.
      expect(refuseLedger.reserved).toEqual([])

      const after = yield* session.messages({ sessionID: created.id })
      // Identity, order and content are untouched — the claim is "changes no identity or content
      // coordinate and creates, deletes or reorders nothing".
      expect(after.map((item) => item.info.id)).toEqual([target.info.id, neighbour.info.id])
      expect(after.map((item) => item.parts.map((part) => part.id))).toEqual(
        before.map((item) => item.parts.map((part) => part.id)),
      )
      expect(after[1]).toEqual(before[1]!)

      // And the ONE field that did change is the one `summary.ts:130` names.
      const written = after[0]!.info
      const original = before[0]!.info
      expect(written.role).toBe("user")
      if (written.role !== "user" || original.role !== "user") return
      expect(written.summary?.diffs).toEqual([])
      expect({ ...written, summary: undefined }).toEqual({ ...original, summary: undefined })
    }),
  )

  itRefuse.instance("refuses to widen: a non-user or absent target is left alone entirely", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "summarize-miss" })
      const seeded = yield* seedUser(created.id, "only")
      const before = yield* session.messages({ sessionID: created.id })

      // `summary.ts:127-128` selects the EXACT requested Message and returns when it is missing or
      // not a user row. That selection is part of the narrow shape: a `summarize` that fell back to
      // "the last user message" could write to a row the caller never named.
      yield* summarizeMissing(created.id)

      expect(yield* session.messages({ sessionID: created.id })).toEqual(before)
      void seeded
    }),
  )
})

const summarizeMissing = (sessionID: SessionID) =>
  Effect.gen(function* () {
    const summary = yield* SessionSummary.Service
    yield* summary.summarize({ sessionID, messageID: MessageID.ascending() })
  })

// ---------------------------------------------------------------------------
// K107 — `exact_closure_capability`
//
// §7.7 names this capability for the closure ToolPart transition and `toolpart-closure.ts` carries
// it. Its registry claim is a REACH claim, so these are reach tests: what the capability may touch,
// and what it must leave exactly as it found it.
//
// They run under the REFUSING coordinator for the same reason the `proven_non_destructive_update`
// tests do. The entry claims this capability carries neither an `AdmissionContext` nor a
// `MutationLease`; under a coordinator that refuses every reservation, "the call succeeded" IS that
// claim in checkable form. An admitting coordinator could not tell taking a lease from not taking
// one.
//
// WHY THIS NEEDS ITS OWN EXERCISE RATHER THAN A `prompt.test.ts` ASSERTION. Both production callers
// only ever invoke the capability on a Part they believe is still active, so the `preserved`
// branches never execute there — and those branches are the K11/K12 race-winner guard, which is the
// most important thing this capability does. A green `prompt.test.ts` says nothing about them. The
// same holds for `pending`, for a missing row, and for a non-tool row: reachable here, unreachable
// from either caller.
// ---------------------------------------------------------------------------

const toolRow = (sessionID: SessionID, messageID: MessageID, state: SessionV1.ToolPart["state"]) =>
  Effect.gen(function* () {
    const session = yield* SessionNs.Service
    const written = yield* session.updatePart({
      id: PartID.ascending(),
      messageID,
      sessionID,
      type: "tool",
      callID: `call_${PartID.ascending()}`,
      tool: "task",
      state,
    } satisfies SessionV1.ToolPart)
    return written as SessionV1.ToolPart
  })

const runningState = () =>
  ({ status: "running", input: { prompt: "work" }, time: { start: 1_000 } }) satisfies SessionV1.ToolStateRunning

const cancelled: SessionToolPart.Terminal = (observed) => ({
  status: "error",
  error: "Cancelled",
  time: { start: observed.status === "running" ? observed.time.start : 2_000, end: 3_000 },
  metadata: observed.status === "running" ? observed.metadata : undefined,
  input: observed.input,
})

const readTool = (sessionID: SessionID, messageID: MessageID, partID: PartID) =>
  Effect.gen(function* () {
    const session = yield* SessionNs.Service
    return yield* session.getPart({ sessionID, messageID, partID })
  })

const statusOf = (part: SessionV1.Part | undefined) => (part?.type === "tool" ? part.state.status : undefined)

describe("K107 exact_closure_capability — terminalizeExact reaches one coordinate and preserves winners", () => {
  itRefuse.instance("terminalizes a running Part while holding no lease at all", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "cap-running" })
      const seeded = yield* seedUser(created.id, "prompt")
      const tool = yield* toolRow(created.id, seeded.info.id, runningState())

      // Positive precondition: the row is genuinely active, so the assertion below is a transition
      // rather than a restatement of the seed.
      expect(statusOf(yield* readTool(created.id, seeded.info.id, tool.id))).toBe("running")

      const observation = yield* SessionToolPart.terminalizeExact({
        session,
        target: { session: created.id, message: seeded.info.id, part: tool.id },
        terminal: cancelled,
      })

      expect(observation).toEqual({ type: "terminalized", outcome: "cancelled" })
      const after = yield* readTool(created.id, seeded.info.id, tool.id)
      expect(statusOf(after)).toBe("error")
      expect(after?.type === "tool" && after.state.status === "error" ? after.state.error : undefined).toBe("Cancelled")

      // The registry claim, in its checkable form: every reservation under this coordinator refuses,
      // so an empty ledger is "took no lease" rather than "took one that happened to succeed".
      expect(refuseLedger.timeline).toEqual([])
    }),
  )

  itRefuse.instance("terminalizes a pending Part too, which is the K42 half no caller can reach", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "cap-pending" })
      const seeded = yield* seedUser(created.id, "prompt")
      const tool = yield* toolRow(created.id, seeded.info.id, {
        status: "pending",
        input: { prompt: "work" },
        raw: '{"prompt":"work"}',
      })

      expect(statusOf(yield* readTool(created.id, seeded.info.id, tool.id))).toBe("pending")

      const observation = yield* SessionToolPart.terminalizeExact({
        session,
        target: { session: created.id, message: seeded.info.id, part: tool.id },
        terminal: cancelled,
      })

      // `prompt.ts` creates its Task Part running, so its old `=== "running"` guard could never see
      // this branch. K42 requires it, and only this exercise reaches it.
      expect(observation).toEqual({ type: "terminalized", outcome: "cancelled" })
      expect(statusOf(yield* readTool(created.id, seeded.info.id, tool.id))).toBe("error")
    }),
  )

  itRefuse.instance("preserves a completed receipt byte-identically and never builds a payload", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "cap-completed" })
      const seeded = yield* seedUser(created.id, "prompt")
      yield* toolRow(created.id, seeded.info.id, {
        status: "completed",
        input: { prompt: "work" },
        output: "the winner's output",
        title: "won",
        time: { start: 1_000, end: 1_500 },
        metadata: { keep: true },
      })

      const before = yield* session.messages({ sessionID: created.id })
      const target = before[0]!.parts.find((part) => part.type === "tool")!
      // Positive precondition: a completed receipt really is present to be preserved.
      expect(statusOf(target)).toBe("completed")

      const built: string[] = []
      const observation = yield* SessionToolPart.terminalizeExact({
        session,
        target: { session: created.id, message: seeded.info.id, part: target.id },
        terminal: (observed) => {
          built.push("built")
          return cancelled(observed)
        },
      })

      // I-11/K11: the winner's outcome stands, and its bytes are exact rather than merely its status.
      expect(observation).toEqual({ type: "preserved", outcome: "completed" })
      expect(yield* session.messages({ sessionID: created.id })).toEqual(before)
      // Structural rather than disciplined: the payload builder is unreachable on this branch, so
      // there is no wrong write available to make.
      expect(built).toEqual([])
    }),
  )

  itRefuse.instance("preserves an error receipt, so cancellation cannot overwrite a real failure", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "cap-error" })
      const seeded = yield* seedUser(created.id, "prompt")
      yield* toolRow(created.id, seeded.info.id, {
        status: "error",
        error: "the original failure",
        input: { prompt: "work" },
        time: { start: 1_000, end: 1_500 },
      })

      const before = yield* session.messages({ sessionID: created.id })
      expect(statusOf(before[0]!.parts.find((part) => part.type === "tool"))).toBe("error")
      const target = before[0]!.parts.find((part) => part.type === "tool")!

      const observation = yield* SessionToolPart.terminalizeExact({
        session,
        target: { session: created.id, message: seeded.info.id, part: target.id },
        terminal: cancelled,
      })

      // K12: the original error is the outcome and the message survives verbatim. Had this written,
      // "the original failure" would have become "Cancelled".
      expect(observation).toEqual({ type: "preserved", outcome: "error" })
      expect(yield* session.messages({ sessionID: created.id })).toEqual(before)
    }),
  )

  itRefuse.instance("reports an absent coordinate as unavailable and writes nothing", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "cap-absent" })
      const seeded = yield* seedUser(created.id, "prompt")
      yield* toolRow(created.id, seeded.info.id, runningState())

      // Positive precondition: the session is NOT empty, so `no_part` is a statement about the
      // named coordinate rather than about a session with nothing in it.
      const before = yield* session.messages({ sessionID: created.id })
      expect(before[0]!.parts.some((part) => part.type === "tool")).toBe(true)

      const observation = yield* SessionToolPart.terminalizeExact({
        session,
        target: { session: created.id, message: seeded.info.id, part: PartID.ascending() },
        terminal: cancelled,
      })

      // K44: an unproven subject never widens authority to a nearby row.
      expect(observation).toEqual({ type: "unavailable", reason: "no_part" })
      expect(yield* session.messages({ sessionID: created.id })).toEqual(before)
    }),
  )

  itRefuse.instance("refuses to terminalize a row that is not a ToolPart, and leaves it exact", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "cap-not-tool" })
      const seeded = yield* seedUser(created.id, "the text row")

      const before = yield* session.messages({ sessionID: created.id })
      expect(seeded.part.type).toBe("text")

      const observation = yield* SessionToolPart.terminalizeExact({
        session,
        target: { session: created.id, message: seeded.info.id, part: seeded.part.id },
        terminal: cancelled,
      })

      // Distinct from `no_part` on purpose: the row exists, so claiming absence would be a false
      // statement about it. Both map to `unknown` upstream, but only one is true here.
      expect(observation).toEqual({ type: "unavailable", reason: "not_a_tool_part" })
      expect(yield* session.messages({ sessionID: created.id })).toEqual(before)
    }),
  )

  itRefuse.instance("reaches only the coordinate it was handed, leaving an active sibling alone", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "cap-reach" })
      const seeded = yield* seedUser(created.id, "prompt")
      const doomed = yield* toolRow(created.id, seeded.info.id, runningState())
      const sibling = yield* toolRow(created.id, seeded.info.id, runningState())

      // Positive precondition: two DISTINCT active rows, so "the sibling is untouched" is a reach
      // statement and not an artefact of there being only one row.
      expect(doomed.id).not.toBe(sibling.id)
      expect(statusOf(yield* readTool(created.id, seeded.info.id, sibling.id))).toBe("running")

      yield* SessionToolPart.terminalizeExact({
        session,
        target: { session: created.id, message: seeded.info.id, part: doomed.id },
        terminal: cancelled,
      })

      // Reach IS the authority: one coordinate in, one row changed.
      expect(statusOf(yield* readTool(created.id, seeded.info.id, doomed.id))).toBe("error")
      expect(yield* readTool(created.id, seeded.info.id, sibling.id)).toEqual(sibling)
    }),
  )
})

// ---------------------------------------------------------------------------
// §7.5 — the closure ToolPart capability's UNFORGEABLE identity. Gate 7 remediation.
//
// §7.5 requires this capability be "allocated only by the canonical operation under the authority
// lock", "contain the exact ... MessageID, PartID, and permitted transition coordinates", be unable
// to "be serialized or supplied by an HTTP/SDK caller", and have an identity "enforced by an
// unforgeable in-process object/brand or equivalent module-private identity".
//
// WHAT THE AUDIT FOUND. None of that held. `terminalizeExact` took a caller-supplied
// `Pick<Session.Interface, "getPart" | "updatePart">` plus caller-supplied coordinates — plain data,
// synthesizable by anything holding a `Session` — and was called from two ORDINARY finalizers as
// well as from closure. The correctness property (winners preserved, one coordinate reached) was
// sound and is unchanged; what was missing was authority.
//
// WHY IT MATTERS NOW rather than when it was written: Gate 8 introduces CP-021 as a real external
// participant, and G8-08 negatively asserts a participant can neither release a core fence nor write
// closure records. A plain-data capability is exactly that authority path. These rows exist so the
// property is checkable before the participant arrives — prose cannot fail.
// ---------------------------------------------------------------------------

const walkSources = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walkSources(full)
    return full.endsWith(".ts") ? [full] : []
  })

/**
 * Refused by the PERMIT CHECK specifically, not merely dead.
 *
 * Matching the message rather than asserting a defect is what makes these rows attributable: a
 * fixture that threw for an unrelated reason — a missing service, a bad coordinate — would satisfy
 * "it died" and report a capability guard that never ran.
 */
const refusedForPermit = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) &&
  Cause.prettyErrors(exit.cause).some((error) => error.message.includes("without a live coordinate-exact permit"))

/**
 * Refused by the WRITE-WINDOW guard specifically, which is a different fact from the admission one.
 *
 * The two refusals carry distinct messages so a row cannot pass by hitting the wrong one. Matching
 * the admission message where the write window is under test would report a capability that merely
 * refused earlier — the pass-for-the-wrong-reason class §6.12 names.
 */
const refusedForWindow = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) &&
  Cause.prettyErrors(exit.cause).some((error) =>
    error.message.includes("revoked between the authoritative read and the write"),
  )

/**
 * Mint a grant the way the coordinator does — through the ISSUER tag, never through `Service`.
 *
 * THIS HELPER IS ITSELF EVIDENCE, which is why it exists rather than the tests reaching for a
 * `grant` member. Gate 7's third audit ruled that minting be split out of the interface the adapter
 * and the terminalizer hold, and the proof that the split is real is that `SessionToolPartPermit
 * .Service` no longer TYPECHECKS with a mint on it: every one of these call sites previously read
 * `permits.grant(...)` and the compiler now rejects that spelling. The split is enforced by the type
 * each holder receives, not by a scanner asserting nobody calls it.
 *
 * `minter` is resolved per call, exactly as `runDriver` resolves it, so the grant lands in the
 * ambient Instance's registry and the cross-Instance row below still exercises real storage scoping.
 */
const mintGrant = (authority: SessionToolPartPermit.Authority) =>
  Effect.gen(function* () {
    const issuer = yield* SessionToolPartPermit.Issuer
    return (yield* issuer.minter).mint(authority)
  })

describe("§7.5 exact_closure_capability — the permit is the authority, and it is not data", () => {
  itRefuse.instance("a forged or serialized permit cannot terminalize; a real one at the same coordinate can", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "permit-forged" })
      const seeded = yield* seedUser(created.id, "prompt")
      const tool = yield* toolRow(created.id, seeded.info.id, runningState())

      // Positive precondition: the row is genuinely active, so a refusal below is a refusal rather
      // than a no-op against an already-terminal row.
      expect(statusOf(yield* readTool(created.id, seeded.info.id, tool.id))).toBe("running")

      const permits = yield* SessionToolPartPermit.Service
      const authority = yield* mintGrant({ instance: "inst_permit", operation: "op_permit" })
      const real = yield* permits.issue(authority.grant, {
        session: created.id,
        message: seeded.info.id,
        part: tool.id,
      })
      expect(real).toBeDefined()

      // The two forgeries actually available to an in-process participant. An empty object is the
      // strongest one that does not import the issuer; the round-trip is §7.5's "cannot be
      // serialized" stated as a fact about this object rather than as a policy — authority lives in
      // a module-private WeakMap, so there is nothing in the bytes to carry.
      const forgeries = [{}, JSON.parse(JSON.stringify(real))] as SessionToolPartPermit.Permit[]
      for (const forged of forgeries) {
        const refused = yield* Effect.exit(
          SessionToolPart.terminalizePermitted({ session, permit: forged, terminal: cancelled }),
        )
        expect(refusedForPermit(refused)).toBe(true)
        // Refused BEFORE mutation. A capability that entered the write and rolled back would still
        // be an authority breach, so the row state is the assertion rather than the return value.
        expect(statusOf(yield* readTool(created.id, seeded.info.id, tool.id))).toBe("running")
      }

      // POSITIVE CONTROL. Same coordinate, same payload, a genuine permit. Without it every
      // assertion above would pass against a capability that refused unconditionally.
      const observation = yield* SessionToolPart.terminalizePermitted({
        session,
        permit: real!,
        terminal: cancelled,
      })
      expect(observation).toEqual({ type: "terminalized", outcome: "cancelled" })
      expect(statusOf(yield* readTool(created.id, seeded.info.id, tool.id))).toBe("error")

      // The capability carries no lease, exactly as the registry claims.
      expect(refuseLedger.timeline).toEqual([])
    }),
  )

  itRefuse.instance("a permit is single-use, so a captured reference cannot be replayed", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "permit-replay" })
      const seeded = yield* seedUser(created.id, "prompt")
      const first = yield* toolRow(created.id, seeded.info.id, runningState())

      const permits = yield* SessionToolPartPermit.Service
      const authority = yield* mintGrant({ instance: "inst_permit", operation: "op_permit" })
      const permit = yield* permits.issue(authority.grant, {
        session: created.id,
        message: seeded.info.id,
        part: first.id,
      })

      expect(yield* SessionToolPart.terminalizePermitted({ session, permit: permit!, terminal: cancelled })).toEqual({
        type: "terminalized",
        outcome: "cancelled",
      })

      // The row is reset to active so the second attempt has something to destroy. Without this the
      // replay would be indistinguishable from a no-op on an already-terminal row — the "preserved"
      // branch would absorb it and the row would pass for the wrong reason.
      yield* session.updatePart({ ...first, state: runningState() } satisfies SessionV1.ToolPart)
      expect(statusOf(yield* readTool(created.id, seeded.info.id, first.id))).toBe("running")

      const replayed = yield* Effect.exit(
        SessionToolPart.terminalizePermitted({ session, permit: permit!, terminal: cancelled }),
      )
      expect(refusedForPermit(replayed)).toBe(true)
      expect(statusOf(yield* readTool(created.id, seeded.info.id, first.id))).toBe("running")
    }),
  )

  /**
   * MUST-FIX 1 — THE INSTANCE AXIS, which the forgery rows above do not touch.
   *
   * WHAT THE RE-AUDIT FOUND. An Instance-A grant and permit wrote successfully through an Instance-B
   * reach, and the REASONING rather than the successful probe is what settled it:
   * `terminalizePermitted` held no information with which it could have rejected a foreign Instance.
   * The WeakMaps were module-global, `Binding.instance` was compared against nothing, `Reach` exposes
   * only `getPart`/`updatePart`, and the function acquired no ambient Instance identity. §7.5 requires
   * Instance binding and I-01 requires every capability belong to exactly one Instance coordinator.
   *
   * WHY THE FIX IS STORAGE RATHER THAN COMPARISON. `event.ts` creates `exactBindings` INSIDE each
   * EventV2 layer, so a foreign token is refused by construction — `core/test/event-exact.test.ts`
   * proves exactly that and this row is its ToolPart analogue. The first fix copied the brand and
   * dropped the scoping. A string comparison of `Binding.instance` would only DETECT the crossing;
   * per-Instance storage makes it unrepresentable, and that is the difference this row asserts.
   *
   * THE REFUSAL LANDS BEFORE THE READ, which is why this cannot pass for the wrong reason. `consume`
   * is the first statement, so the foreign permit is rejected without `getPart` ever running — the
   * row therefore cannot be satisfied by a second Instance that merely fails to see the database.
   */
  itRefuse.instance("a permit minted under one Instance cannot terminalize through another's reach", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "permit-instance" })
      const seeded = yield* seedUser(created.id, "prompt")
      const crossed = yield* toolRow(created.id, seeded.info.id, runningState())
      const control = yield* toolRow(created.id, seeded.info.id, runningState())

      // One grant, two permits at two coordinates. Two are needed because a permit is single-use:
      // reusing one would confound the Instance axis with the replay axis the row above owns.
      const permits = yield* SessionToolPartPermit.Service
      const authority = yield* mintGrant({ instance: "inst_home", operation: "op_home" })
      const foreign = yield* permits.issue(authority.grant, {
        session: created.id,
        message: seeded.info.id,
        part: crossed.id,
      })
      const native = yield* permits.issue(authority.grant, {
        session: created.id,
        message: seeded.info.id,
        part: control.id,
      })
      expect(foreign).toBeDefined()
      expect(native).toBeDefined()

      const elsewhere = mkdtempSync(join(tmpdir(), "cp023-instance-"))
      try {
        const refused = yield* Effect.gen(function* () {
          // INSTANCE B'S REACH, re-acquired under B's ambient context rather than carried in from A,
          // so this is literally the shape the re-audit exercised.
          const theirs = yield* SessionNs.Service
          return yield* Effect.exit(
            SessionToolPart.terminalizePermitted({ session: theirs, permit: foreign!, terminal: cancelled }),
          )
        }).pipe(provideInstance(elsewhere))

        expect(refusedForPermit(refused)).toBe(true)
        // Refused BEFORE mutation, read back under the Instance that owns the row.
        expect(statusOf(yield* readTool(created.id, seeded.info.id, crossed.id))).toBe("running")
      } finally {
        rmSync(elsewhere, { recursive: true, force: true })
      }

      // POSITIVE CONTROL, and the load-bearing half. Without it every assertion above would pass
      // against a capability that had been broken outright — or against a grant the crossing had
      // silently revoked. The SAME grant still issues and still writes in its own Instance.
      expect(yield* SessionToolPart.terminalizePermitted({ session, permit: native!, terminal: cancelled })).toEqual({
        type: "terminalized",
        outcome: "cancelled",
      })
      expect(statusOf(yield* readTool(created.id, seeded.info.id, control.id))).toBe("error")
      expect(refuseLedger.timeline).toEqual([])
    }),
  )

  itRefuse.instance("a permit issued inside a live run is refused once the coordinator revokes its grant", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "permit-revoked" })
      const seeded = yield* seedUser(created.id, "prompt")
      const tool = yield* toolRow(created.id, seeded.info.id, runningState())

      // Issued while the grant STANDS, which is what makes this a liveness row rather than a
      // restatement of the forgery row: the permit was genuinely valid at the moment it was minted.
      const permits = yield* SessionToolPartPermit.Service
      const authority = yield* mintGrant({ instance: "inst_permit", operation: "op_permit" })
      const permit = yield* permits.issue(authority.grant, {
        session: created.id,
        message: seeded.info.id,
        part: tool.id,
      })
      expect(permit).toBeDefined()

      // `runDriver` installs exactly this as an `ensuring`, so it runs when the driver run returns,
      // fails, or is interrupted. This row revokes BEFORE consumption, so it exercises the admission
      // window; the write window — revocation landing after `consume` and before the write — is a
      // separate row below, because Gate 7's re-audit showed one check does not cover both.
      yield* authority.revoke

      const refused = yield* Effect.exit(
        SessionToolPart.terminalizePermitted({ session, permit: permit!, terminal: cancelled }),
      )
      expect(refusedForPermit(refused)).toBe(true)
      expect(statusOf(yield* readTool(created.id, seeded.info.id, tool.id))).toBe("running")
    }),
  )

  itRefuse.instance("a revoked grant issues nothing at all, so the adapter degrades rather than writes", () =>
    Effect.gen(function* () {
      const permits = yield* SessionToolPartPermit.Service
      const authority = yield* mintGrant({ instance: "inst_permit", operation: "op_permit" })
      const coordinate = {
        session: SessionID.make("ses_permit"),
        message: MessageID.make("msg_permit"),
        part: PartID.make("prt_permit"),
      }

      // Positive precondition: issuing works while the grant stands, so `undefined` below is caused
      // by the revocation and not by a coordinate the issuer never accepted.
      expect(yield* permits.issue(authority.grant, coordinate)).toBeDefined()
      yield* authority.revoke
      expect(yield* permits.issue(authority.grant, coordinate)).toBeUndefined()
    }),
  )

  /**
   * MUST-FIX 3 — THE WRITE WINDOW, which the admission check above does not cover.
   *
   * §6.12's prose claimed `consume()` re-checked liveness "because the window spans a DB read plus a
   * conditional write". That was false as implemented: liveness was checked once, BEFORE the read.
   * Gate 7's re-audit blocked the read, revoked mid-flight, released, and the write succeeded.
   *
   * The block is a `getPart` that suspends until the test revokes. That is what makes this row a
   * genuine window test rather than a restatement of the revoked-grant row: the permit is admitted
   * while the grant stands, and the revocation lands strictly between the authoritative read and
   * the conditional write.
   *
   * NOT AN ESTABLISHED PRODUCTION RACE, and the row says so rather than overclaiming. `runDriver`
   * awaits `driver.run` and `driver.ts:capture` awaits the adapter before `Effect.ensuring` runs, so
   * the current call graph cannot reach it. A CP-021 participant at Gate 8 is the caller that could.
   */
  itRefuse.instance("a grant revoked between the authoritative read and the write refuses the write", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "permit-window" })
      const seeded = yield* seedUser(created.id, "prompt")
      const tool = yield* toolRow(created.id, seeded.info.id, runningState())

      const permits = yield* SessionToolPartPermit.Service
      const authority = yield* mintGrant({ instance: "inst_window", operation: "op_window" })
      const permit = yield* permits.issue(authority.grant, {
        session: created.id,
        message: seeded.info.id,
        part: tool.id,
      })
      expect(permit).toBeDefined()

      // The reach whose READ is the window. `getPart` delegates to the real service and then revokes
      // before returning, so the capability resumes into a world where its authority has ended —
      // exactly the interleaving the re-audit produced by blocking the read.
      const racing: SessionToolPart.Reach = {
        getPart: (input) =>
          session.getPart(input).pipe(Effect.tap(() => authority.revoke)) as ReturnType<SessionNs.Interface["getPart"]>,
        updatePart: session.updatePart,
      }

      const refused = yield* Effect.exit(
        SessionToolPart.terminalizePermitted({ session: racing, permit: permit!, terminal: cancelled }),
      )

      // Attributed to the WRITE window specifically. Matching the admission message here would pass
      // against a capability that had merely refused earlier, which is the wrong fact.
      expect(
        Exit.isFailure(refused) &&
          Cause.prettyErrors(refused.cause).some((error) =>
            error.message.includes("revoked between the authoritative read and the write"),
          ),
      ).toBe(true)
      expect(statusOf(yield* readTool(created.id, seeded.info.id, tool.id))).toBe("running")

      // POSITIVE CONTROL. The same reach without the mid-flight revocation writes, so the refusal
      // above is caused by the revocation rather than by the wrapped reach.
      const second = yield* toolRow(created.id, seeded.info.id, runningState())
      const live = yield* mintGrant({ instance: "inst_window", operation: "op_window" })
      const ok = yield* permits.issue(live.grant, {
        session: created.id,
        message: seeded.info.id,
        part: second.id,
      })
      expect(yield* SessionToolPart.terminalizePermitted({ session, permit: ok!, terminal: cancelled })).toEqual({
        type: "terminalized",
        outcome: "cancelled",
      })
      expect(statusOf(yield* readTool(created.id, seeded.info.id, second.id))).toBe("error")
    }),
  )

  /**
   * MUST-FIX 1 (third audit) — THE INTERLEAVING THE PREVIOUS FIX COULD NOT CLOSE.
   *
   * WHY THE ROW ABOVE WAS NOT ENOUGH, and this is the transferable part. That row revokes inside
   * `getPart`, so the revocation completes strictly BEFORE the capability reaches its authority
   * test — which the old pre-write re-check caught. The audit defeated that re-check by moving the
   * revocation one step later: park a real `updatePart` AFTER the check, revoke from another fiber,
   * release, and the write lands under a dead authority. The ToolPart went `running` -> `error`
   * where refusal was expected. Its verdict named why no further check could work — "another
   * pre-write recheck would merely move the same TOCTOU window" — so the fix had to stop being a
   * check at all.
   *
   * WHAT THIS ASSERTS, and why it is the kill. `commit` runs the write inside the grant's one-permit
   * gate and `revoke` must take that same gate, so the two cannot interleave. While the write is
   * parked, revocation is STRUCTURALLY unable to complete. The sleep below is sound as evidence
   * precisely because the negative is structural rather than probabilistic: under the correct
   * protocol this fiber can never finish, and under an unserialized one it finishes in microseconds.
   *
   * The authored mutant `gate7b-write-window-liveness-dropped` could not have established this — it
   * removed the re-check while its test revoked during `observe`, so killing it only ever proved the
   * ADMISSION window. Both the mutant and its test are rebuilt for this row.
   */
  itRefuse.instance("revocation cannot land between the grant's authority test and its write", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "permit-atomic" })
      const seeded = yield* seedUser(created.id, "prompt")
      const tool = yield* toolRow(created.id, seeded.info.id, runningState())

      const permits = yield* SessionToolPartPermit.Service
      const authority = yield* mintGrant({ instance: "inst_atomic", operation: "op_atomic" })
      const permit = yield* permits.issue(authority.grant, {
        session: created.id,
        message: seeded.info.id,
        part: tool.id,
      })
      expect(permit).toBeDefined()

      const atWrite = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()

      // The reach whose WRITE parks. `getPart` is untouched, so the authority test has already
      // passed and the row has already been read when this suspends — exactly the instant the
      // re-audit exploited.
      const parking: SessionToolPart.Reach = {
        getPart: session.getPart,
        updatePart: ((part: SessionV1.Part) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(atWrite, undefined)
            yield* Deferred.await(release)
            return yield* session.updatePart(part)
          })) as SessionNs.Interface["updatePart"],
      }

      const writing = yield* SessionToolPart.terminalizePermitted({
        session: parking,
        permit: permit!,
        terminal: cancelled,
      }).pipe(Effect.forkScoped)
      yield* Deferred.await(atWrite)

      // Revocation attempted while an admitted use holds the gate. A flag rather than `Fiber.poll`
      // so the observable is "revoke RETURNED", which is the fact in question.
      const revoked = { done: false }
      const revoking = yield* authority.revoke.pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            revoked.done = true
          }),
        ),
        Effect.forkScoped,
      )

      // THE KILL. Unserialized, this is `true` within microseconds.
      yield* Effect.sleep("50 millis")
      expect(revoked.done).toBe(false)

      yield* Deferred.succeed(release, undefined)
      const observation = yield* Fiber.join(writing)
      yield* Fiber.join(revoking)
      expect(revoked.done).toBe(true)

      // THE ADMITTED USE COMPLETES, which is the correct half of the contract rather than an
      // accident. It was admitted while the authority stood, so revocation waits for it instead of
      // invalidating a write already in flight.
      expect(observation).toEqual({ type: "terminalized", outcome: "cancelled" })
      expect(statusOf(yield* readTool(created.id, seeded.info.id, tool.id))).toBe("error")

      // ...and revocation really did take effect rather than being lost while it waited. Without
      // this the row could not distinguish "revoke blocked, then applied" from "revoke swallowed".
      const next = yield* toolRow(created.id, seeded.info.id, runningState())
      expect(
        yield* permits.issue(authority.grant, { session: created.id, message: seeded.info.id, part: next.id }),
      ).toBeUndefined()
    }),
  )

  /**
   * THE REAL ADAPTER, not a fake of it.
   *
   * `closure/toolpart.ts` had no behavioural coverage at all before this: `closure-layer.test.ts`
   * builds its node to prove the graph composes, and every `terminalize` exercise in
   * `closure-driver.test.ts` runs against a scripted fake. So the one module that actually joins the
   * driver's coordinate to the capability's write was verified only by inspection — the
   * production-path/test-path divergence §6.9 calls this CP's most productive defect source, at the
   * exact seam this gate changed.
   */
  itRefuse.instance("the real adapter resolves a call to a Part and terminalizes it under a live grant", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "adapter-live" })
      const seeded = yield* seedUser(created.id, "prompt")
      const tool = yield* toolRow(created.id, seeded.info.id, runningState())
      expect(statusOf(yield* readTool(created.id, seeded.info.id, tool.id))).toBe("running")

      const adapter = yield* SessionClosureToolPart.Service
      // The SAME service the adapter's own layer acquired, obtained from the same context. That is
      // deliberate: if the graph handed the adapter a different registry, issue inside it would
      // not find this grant and the row would report `unknown` instead of terminalizing.
      const permits = yield* SessionToolPartPermit.Service
      const authority = yield* mintGrant({ instance: "inst_adapter", operation: "op_adapter" })

      // The driver names a tool CALL, never a PartID — `Tool.Context` carries no `partID`. Resolving
      // the call to a row is this adapter's whole reason to exist, so handing it a callID and
      // expecting the Part back is the assertion that matters.
      const found = yield* adapter.terminalize({
        session: created.id,
        message: seeded.info.id,
        call: tool.callID,
        grant: authority.grant,
      })

      expect(found).toEqual({ outcome: "cancelled", part: tool.id })
      const after = yield* readTool(created.id, seeded.info.id, tool.id)
      expect(statusOf(after)).toBe("error")
      expect(after?.type === "tool" && after.state.status === "error" ? after.state.error : undefined).toBe("Cancelled")
      expect(refuseLedger.timeline).toEqual([])
    }).pipe(Effect.provide(SessionClosureToolPart.layer)),
  )

  itRefuse.instance("the real adapter degrades to `unknown` and writes nothing when its grant is dead", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "adapter-dead" })
      const seeded = yield* seedUser(created.id, "prompt")
      const tool = yield* toolRow(created.id, seeded.info.id, runningState())
      const before = yield* readTool(created.id, seeded.info.id, tool.id)

      const adapter = yield* SessionClosureToolPart.Service
      // The SAME service the adapter's own layer acquired, obtained from the same context. That is
      // deliberate: if the graph handed the adapter a different registry, issue inside it would
      // not find this grant and the row would report `unknown` instead of terminalizing.
      const permits = yield* SessionToolPartPermit.Service
      const authority = yield* mintGrant({ instance: "inst_adapter", operation: "op_adapter" })
      yield* authority.revoke

      // §8.5 forbids reading missing state as a positive fact, and an unissuable permit means this
      // subject's race winner was never acted upon. The honest answer is `unknown` with no write —
      // NOT a defect, which would turn a revoked grant on a late sweep into a crash, and NOT an
      // ungated write, which is the whole thing §7.5 exists to prevent.
      const found = yield* adapter.terminalize({
        session: created.id,
        message: seeded.info.id,
        call: tool.callID,
        grant: authority.grant,
      })

      expect(found).toEqual({ outcome: "unknown" })
      expect(yield* readTool(created.id, seeded.info.id, tool.id)).toEqual(before)
      expect(statusOf(before)).toBe("running")
    }).pipe(Effect.provide(SessionClosureToolPart.layer)),
  )

  itRefuse.instance("the real adapter preserves a completed receipt byte-identically", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "adapter-winner" })
      const seeded = yield* seedUser(created.id, "prompt")
      const tool = yield* toolRow(created.id, seeded.info.id, {
        status: "completed",
        input: { prompt: "work" },
        output: "done",
        title: "task",
        metadata: {},
        time: { start: 1_000, end: 2_000 },
      })
      const before = yield* readTool(created.id, seeded.info.id, tool.id)

      const adapter = yield* SessionClosureToolPart.Service
      // The SAME service the adapter's own layer acquired, obtained from the same context. That is
      // deliberate: if the graph handed the adapter a different registry, issue inside it would
      // not find this grant and the row would report `unknown` instead of terminalizing.
      const permits = yield* SessionToolPartPermit.Service
      const authority = yield* mintGrant({ instance: "inst_adapter", operation: "op_adapter" })

      const found = yield* adapter.terminalize({
        session: created.id,
        message: seeded.info.id,
        call: tool.callID,
        grant: authority.grant,
      })

      // K11/K12 through the REAL path: the winner's outcome is reported, its bytes stand, and the
      // permit is spent without a write.
      expect(found).toEqual({ outcome: "completed", part: tool.id })
      expect(yield* readTool(created.id, seeded.info.id, tool.id)).toEqual(before)
    }).pipe(Effect.provide(SessionClosureToolPart.layer)),
  )

  /**
   * MUST-FIX 2 — the mint's bound, rebuilt a SECOND time, and this time not as a scanner.
   *
   * TWO REFUTATIONS, and the pattern across them is the finding. Round 2's bound was
   * `readFileSync(file).includes("SessionToolPartPermit.grant(")`, defeated by an aliased import.
   * Round 3 replaced it with an AST scanner and that was defeated by `permits["grant"](...)` placed
   * in the real adapter path — 40 pass / 0 fail, typecheck exit 0, and the inventory still asserting
   * exactly one mint call site. Two rounds of making the bad thing DETECTABLE, two evasions by forms
   * the detector did not anticipate.
   *
   * WHAT BOUNDS THE MINT NOW, and the first layer is not a detector at all:
   *
   *   1. THE INTERFACE. Minting lives on `SessionToolPartPermit.Issuer`, acquired only by the
   *      coordinator. `closure/toolpart.ts` and `toolpart-closure.ts` acquire `Service`, whose
   *      interface has NO allocator. The adapter cannot mint under any spelling — aliased, computed,
   *      captured — because there is no member to reach. `permits.grant(...)` no longer typechecks
   *      anywhere, which is why every fixture above had to move to `mintGrant`.
   *   2. ACQUISITION. Holding either tag is still what confers reach, so the AST acquisition
   *      inventory pins each tag to a disjoint file set and now REFUSES aliased imports rather than
   *      matching the receiver by name — the form that made a namespace alias invisible.
   *   3. CALL. Within that bounded surface `.mint(` is called exactly once, and the scanner refuses
   *      computed dispatch and captured references instead of walking past them.
   *
   * Layers 2 and 3 are defence in depth. Layer 1 is the one that makes the property structural.
   */
  test("the two permit tags are acquired in disjoint file sets, and neither holder can reach the other's", () => {
    const root = join(import.meta.dir, "..", "..", "src")
    const consumer = scanServiceAcquisitions(root, {
      specifier: "session/toolpart-permit",
      namespace: "SessionToolPartPermit",
      member: "Service",
    })
    const issuer = scanServiceAcquisitions(root, {
      specifier: "session/toolpart-permit",
      namespace: "SessionToolPartPermit",
      member: "Issuer",
    })

    // Positive precondition: the walk reached this package's source, so a short list below is a
    // bounded surface rather than a broken walk.
    expect(walkSources(root).length).toBeGreaterThan(100)

    // An aliased import of this module is REFUSED, so an empty refusal list is what makes the two
    // sets below mean "these are all of them" rather than "these are the ones spelled the way the
    // scanner expects". Round 2's evasion is exactly the shape this covers.
    expect(consumer.unresolved.map((item) => `${item.file}:${item.line} — ${item.reason}`)).toEqual([])
    expect(issuer.unresolved.map((item) => `${item.file}:${item.line} — ${item.reason}`)).toEqual([])

    // THE CONSUMER SURFACE. No `imported` or `computed` form exists today; asserting the FORM as
    // well as the file keeps a later auto-import from landing as an invisible extra holder.
    expect(consumer.acquisitions.map((item) => `${item.file}::${item.form}`)).toEqual([
      // Issues the coordinate-exact permit, and provides the same service into the capability so the
      // issue side and the consume side cannot resolve different registries.
      "session/closure/toolpart.ts::qualified",
      "session/closure/toolpart.ts::qualified",
      // Consumes, and performs the gated write, inside `terminalizePermitted`.
      "session/toolpart-closure.ts::qualified",
    ])

    // THE MINTING SURFACE, and the whole of it. One file.
    expect(issuer.acquisitions.map((item) => `${item.file}::${item.form}`)).toEqual([
      "session/closure/coordinator.ts::qualified",
    ])

    // THE SPLIT, asserted as a disjointness rather than inferred from the two lists above. The
    // coordinator never holds the consumer tag and the two consumers never hold the issuer tag, so
    // no file in `src/` can both mint and spend.
    const consumerFiles = new Set(consumer.acquisitions.map((item) => item.file))
    const issuerFiles = new Set(issuer.acquisitions.map((item) => item.file))
    expect([...consumerFiles].filter((file) => issuerFiles.has(file))).toEqual([])
  })

  test("`mint` has exactly one call site, and it is the coordinator's locked authorization", () => {
    const root = join(import.meta.dir, "..", "..", "src")
    const { sites, unresolved } = scanMemberCalls(root, ["mint"])

    // A computed call or a captured reference anywhere in `src/` fails here rather than shrinking
    // the set silently. This is the assertion round 3 did not have, and its absence is what let
    // `permits["grant"](...)` sit in the adapter path with the suite green.
    expect(unresolved.map((item) => `${item.file}:${item.line} — ${item.reason}`)).toEqual([])

    // The soundness precondition `scanMemberCalls` documents: this bare-name scan is only a valid
    // bound while nothing else in `src/` calls a method called `mint`. Asserting the whole set
    // rather than filtering to the expected file is what keeps that true — an unrelated `.mint(`
    // anywhere fails here and gets reviewed rather than silently widening the surface.
    //
    // `authorize`, NOT `runDriver`, and the difference is MUST-FIX 3. The mint moved inside the
    // `locked(...)` thunk that certifies the exact worker, so §7.5's "allocated only by the
    // canonical operation under the authority lock" is satisfied by the call's POSITION rather than
    // by a comment claiming an adjacent lock had certified something.
    expect(sites.map((site) => `${site.file}::${site.symbol}`)).toEqual(["session/closure/coordinator.ts::authorize"])
    expect(sites[0]!.calls).toHaveLength(1)
  })

  /**
   * MUST-FIX 3 — the mint is LEXICALLY inside the authority lock, not merely after it.
   *
   * WHAT THE RE-AUDIT FOUND. `exactWorker` checked the worker inside `locked(...)`, returned, and
   * released; `runDriver` then called `grant(...)` outside it. The comment claimed §7.5's allocation
   * clause was "satisfied literally" and it was not — verified by execution, since parking the
   * allocation did not block `closure.view`.
   *
   * WHY THIS ROW IS A SOURCE-SHAPE ASSERTION AND SAYS SO. The atomicity itself is structural:
   * `authorize` returns the certified worker AND its authority from one `locked` thunk, so there is
   * no coordinator path that mints without having just certified, and `Minter` exists precisely
   * because `locked` admits only a synchronous thunk. What a runtime test cannot show is that a
   * LATER edit did not move the call back out — the mint is synchronous and in-memory, so there is
   * no observable to park on. This row is therefore defence in depth over a one-site bound, in the
   * same class as `gate7b-inventory-follows-an-aliased-import`: for a positional contract the
   * scanner IS the defence.
   */
  test("the one mint call sits lexically inside a `locked(...)` critical section", () => {
    const root = join(import.meta.dir, "..", "..", "src")
    const source = readFileSync(join(root, "session", "closure", "coordinator.ts"), "utf8")

    // The `authorize` body, bounded by its own declaration and the next top-level `const`/`function`.
    const start = source.indexOf("const authorize = (")
    expect(start).toBeGreaterThan(0)
    const end = source.indexOf("\nfunction runDriver(", start)
    expect(end).toBeGreaterThan(start)
    const body = source.slice(start, end)

    // The mint is inside `authorize`, and `authorize`'s whole body is one `locked(...)` call.
    expect(body).toContain("minter.mint({")
    expect(body).toContain("locked(runtime, () => {")
    expect(body.indexOf("locked(runtime, () => {")).toBeLessThan(body.indexOf("minter.mint({"))

    // And `runDriver` itself does not mint — the shape the re-audit found. Asserting the negative
    // here is what keeps a future edit from re-introducing an adjacent post-lock allocation.
    const driver = source.slice(end)
    expect(driver).not.toContain(".mint(")
  })

  test("`terminalizeExact` and `terminalizePermitted` have exactly their classified callers", () => {
    const root = join(import.meta.dir, "..", "..", "src")
    const inventory = scanExportedCalls(root, {
      specifier: "session/toolpart-closure",
      namespace: "SessionToolPart",
      members: ["terminalizeExact", "terminalizePermitted"],
    })

    // THE SECOND HALF OF MUST-FIX 2, and the one no instrument covered at all. K106 inventories the
    // `Session.updatePart` call INSIDE `terminalizeExact`; nothing inventoried CALLERS OF it. A
    // later in-process module could have invoked the exported helper and written an arbitrary active
    // coordinate with no permit, adding no tracked `updatePart` site and failing nothing. The
    // re-audit verified that by execution.
    expect(inventory.calls.map((call) => `${call.file}::${call.symbol}::${call.member}`)).toEqual([
      // `exact_closure_capability` — the closure adapter, an INDEPENDENT observer ending a Part it
      // did not create. The one caller that must hold a permit.
      "session/closure/toolpart.ts::terminalize::terminalizePermitted",
      // `cancellation_owned_terminalization` — same-fiber finalizers ending Parts their own body
      // created. They require no permit and must not: demanding one would make an ordinary interrupt
      // depend on a canonical closure operation that does not exist on that path.
      "session/processor.ts::cleanup::terminalizeExact",
      "session/prompt.ts::handleSubtaskAdmitted::terminalizeExact",
    ])
    expect(inventory.unresolved).toEqual([])
  })

  /**
   * THE INSTRUMENTS' OWN FALSIFICATION, aimed at the scanners that actually guard the current path.
   *
   * WHY THE PREVIOUS VERSION OF THIS TEST WAS ONLY PARTLY MEANINGFUL, recorded because it looked
   * like standing coverage and passed. It exercised `scanExportedCalls` against `Permits.grant` —
   * but `grant` had already stopped being an exported module function and become a SERVICE method,
   * so the row falsified an instrument that no longer guarded the mint. The two scanners that did
   * guard it, `scanServiceAcquisitions` and `scanMemberCalls`, had no falsification at all, and both
   * were duly defeated by execution at the next audit.
   *
   * THE THREE EVASIONS BELOW ARE THE DEMONSTRATED ONES, not hypothetical variants: a namespace alias
   * that made an acquisition invisible, a computed call that made a mint invisible, and a captured
   * reference whose call site cannot be resolved. Each must be REFUSED — failing the inventory —
   * rather than followed or skipped, and each is paired with a positive control proving the scanner
   * still resolves the honest form.
   */
  test("the acquisition inventory refuses an aliased namespace import instead of missing it", () => {
    /**
     * ONE ROOT PER EVASION, and the first draft of this row got it wrong in an instructive way.
     *
     * Import-alias refusal is a property of the FILE'S IMPORT SURFACE, not of the member being
     * sought: `collectImports` refuses an aliased binding before it knows whether this scan is
     * looking for `Service` or `Issuer`. Two evasions sharing one tree therefore each appear in the
     * other's scan, and neither assertion can be exact. That is correct scanner behaviour — an
     * aliased import of this module is unkeyable whatever member it reaches — so the fixture is what
     * had to change, not the instrument.
     */
    const scanIsolated = (name: string, lines: readonly string[], member: string) => {
      const root = mkdtempSync(join(tmpdir(), "cp023-acquisition-"))
      try {
        mkdirSync(join(root, "session"), { recursive: true })
        writeFileSync(join(root, "session", name), [...lines, ""].join("\n"))
        return scanServiceAcquisitions(root, {
          specifier: "session/toolpart-permit",
          namespace: "SessionToolPartPermit",
          member,
        })
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }

    // THE EVASION. Round 3's scanner matched the receiver by NAME against the expected namespace,
    // so a namespace import under any other local name acquired the tag invisibly.
    const namespaceAlias = scanIsolated(
      "aliased-namespace.ts",
      [
        `import * as Permits from "./toolpart-permit"`,
        `export const grab = Effect.gen(function* () {`,
        `  return yield* Permits.Issuer`,
        `})`,
      ],
      "Issuer",
    )
    // REFUSED, and also REPORTED. The local name is tracked so the acquisition row appears too —
    // a reader gets both "this file acquires the tag" and "the inventory could not key its name".
    expect(namespaceAlias.unresolved.map((item) => `${item.file}::${item.reason}`)).toEqual([
      "session/aliased-namespace.ts::module namespace imported under a different local name; the inventory cannot key an alias",
    ])
    expect(namespaceAlias.acquisitions.map((item) => item.file)).toEqual(["session/aliased-namespace.ts"])

    // The named-import spelling of the same evasion.
    const namedAlias = scanIsolated(
      "aliased-named.ts",
      [
        `import { SessionToolPartPermit as Perms } from "./toolpart-permit"`,
        `export const grabToo = Effect.gen(function* () {`,
        `  return yield* Perms.Service`,
        `})`,
      ],
      "Service",
    )
    expect(namedAlias.unresolved.map((item) => `${item.file}::${item.reason}`)).toEqual([
      "session/aliased-named.ts::tracked binding imported under an alias; the inventory cannot key an alias",
    ])
    expect(namedAlias.acquisitions.map((item) => item.file)).toEqual(["session/aliased-named.ts"])

    // POSITIVE CONTROL. The honest spelling resolves with no refusal, so the rows above are caused
    // by the alias rather than by a scanner that refuses everything.
    const honest = scanIsolated(
      "honest-holder.ts",
      [
        `import { SessionToolPartPermit } from "./toolpart-permit"`,
        `export const grab = Effect.gen(function* () {`,
        `  return yield* SessionToolPartPermit.Issuer`,
        `})`,
      ],
      "Issuer",
    )
    expect(honest.unresolved).toEqual([])
    expect(honest.acquisitions.map((item) => `${item.file}::${item.form}`)).toEqual([
      "session/honest-holder.ts::qualified",
    ])
  })

  test("the member-call inventory refuses a computed call and a captured reference instead of skipping them", () => {
    const root = mkdtempSync(join(tmpdir(), "cp023-membercall-"))
    try {
      mkdirSync(join(root, "session"), { recursive: true })
      // THE EXACT EVASION Gate 7's third audit placed in the real adapter path. Round 3's scanner
      // matched only `PropertyAccessExpression` callees, so this minted with the suite green and the
      // inventory still asserting exactly one call site.
      writeFileSync(
        join(root, "session", "computed-mint.ts"),
        [`export const sneak = (permits: any, authority: any) => permits["mint"](authority)`, ``].join("\n"),
      )
      // The other invisible form: capture the method, call it somewhere the AST cannot follow.
      writeFileSync(
        join(root, "session", "captured-mint.ts"),
        [`export const grab = (permits: any) => {`, `  const later = permits.mint`, `  return later`, `}`, ``].join(
          "\n",
        ),
      )

      const { sites, unresolved } = scanMemberCalls(root, ["mint"])

      // NOTHING RESOLVED, and that is the point: neither evasion produces a `Site`, so a scanner
      // without the refusal channel would have reported an EMPTY set and passed a "exactly one call
      // site" assertion by finding none at all.
      expect(sites).toEqual([])
      expect(unresolved.map((item) => `${item.file}::${item.reason}`).sort()).toEqual([
        "session/captured-mint.ts::tracked member referenced without being called; its eventual call site cannot be resolved",
        "session/computed-mint.ts::computed-property call; rewrite as a direct property access so the inventory can key it",
      ])

      // POSITIVE CONTROL. An ordinary call still resolves to its enclosing symbol with no refusal.
      const honestRoot = mkdtempSync(join(tmpdir(), "cp023-membercall-ok-"))
      try {
        mkdirSync(join(honestRoot, "session"), { recursive: true })
        writeFileSync(
          join(honestRoot, "session", "honest-mint.ts"),
          [`export const ordinary = (permits: any, authority: any) => permits.mint(authority)`, ``].join("\n"),
        )
        const honest = scanMemberCalls(honestRoot, ["mint"])
        expect(honest.unresolved).toEqual([])
        expect(honest.sites.map((site) => `${site.file}::${site.symbol}`)).toEqual(["session/honest-mint.ts::ordinary"])
      } finally {
        rmSync(honestRoot, { recursive: true, force: true })
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  /**
   * The EXPORTED-FUNCTION inventory's falsification, retained because `terminalizeExact` and
   * `terminalizePermitted` genuinely are exported module functions and this scanner genuinely does
   * guard their callers. Unlike the `grant` row it replaces, the instrument under test here is the
   * one that bounds the thing being asserted.
   */
  test("the exported-call inventory refuses the aliased, computed and captured forms", () => {
    const root = mkdtempSync(join(tmpdir(), "cp023-inventory-"))
    try {
      mkdirSync(join(root, "session"), { recursive: true })
      writeFileSync(
        join(root, "session", "aliased-caller.ts"),
        [
          `import { SessionToolPart as Helper } from "./toolpart-closure"`,
          `export const viaAlias = (input: never) => Helper.terminalizeExact(input)`,
          ``,
        ].join("\n"),
      )
      writeFileSync(
        join(root, "session", "sneaky-caller.ts"),
        [
          `import { SessionToolPart } from "./toolpart-closure"`,
          `export const viaComputed = (input: never) => SessionToolPart["terminalizeExact"](input)`,
          `export const captured = SessionToolPart.terminalizeExact`,
          ``,
        ].join("\n"),
      )

      const helper = scanExportedCalls(root, {
        specifier: "session/toolpart-closure",
        namespace: "SessionToolPart",
        members: ["terminalizeExact"],
      })
      // The alias is REFUSED, not followed and not skipped. `Helper` never enters `namespaces`, so
      // no call is recorded from it — the refusal is what carries the signal.
      expect(helper.calls).toEqual([])
      expect(helper.unresolved.map((item) => item.reason).sort()).toEqual([
        "computed-property access; rewrite as a direct property access so the inventory can key it",
        "tracked binding imported under an alias; the inventory cannot key an alias",
        "tracked symbol referenced without being called; its eventual call site cannot be resolved",
      ])

      // POSITIVE CONTROL. The same scanner RESOLVES an ordinary unaliased call, so the refusals
      // above are caused by the evasion rather than by a scanner that reports nothing.
      writeFileSync(
        join(root, "session", "honest-caller.ts"),
        [
          `import { SessionToolPart } from "./toolpart-closure"`,
          `export const ordinary = (input: never) => SessionToolPart.terminalizeExact(input)`,
          ``,
        ].join("\n"),
      )
      const honest = scanExportedCalls(root, {
        specifier: "session/toolpart-closure",
        namespace: "SessionToolPart",
        members: ["terminalizeExact"],
      })
      expect(honest.calls.map((call) => `${call.file}::${call.symbol}::${call.form}`)).toEqual([
        "session/honest-caller.ts::ordinary::qualified",
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// K108 — "rejects BEFORE mutation".
//
// The clause is the load-bearing one. A test that asserted only "the row is unchanged" would pass
// against a seam that entered the destructive body, attempted the write and rolled it back — and
// that seam would be a genuine I-22 violation, because the closure's guarantee is that no
// intersecting destructive mutation ENTERS between generation verification and fence release, not
// that it leaves no trace.
//
// So the instrument is a timeline, and the body's FIRST statement is what it records. Entry, not
// outcome.
// ---------------------------------------------------------------------------

const replacePart = (ledger: MutationLedger, part: SessionV1.TextPart, text: string) =>
  Effect.gen(function* () {
    ledger.timeline.push("body")
    const session = yield* SessionNs.Service
    return yield* session.updatePart({ ...part, type: "text", text } satisfies SessionV1.TextPart)
  })

describe("K108 destructive update rejects before the mutation body is entered", () => {
  itAdmit.instance("positive control: an admitted replace_part enters the body and replaces the row", () =>
    Effect.gen(function* () {
      yield* reset(admitLedger)
      const session = yield* SessionNs.Service
      const closure = yield* SessionClosure.Service
      const created = yield* session.create({ title: "replace-admit" })
      const seeded = yield* seedUser(created.id, "original")

      yield* SessionMutation.leased(
        closure,
        { sessions: [created.id], kind: "replace_part" },
        replacePart(admitLedger, seeded.part, "replaced"),
      )

      // This is what makes the refusal test below non-vacuous: the exact same body, through the
      // exact same seam, DOES enter and DOES persist when admission succeeds.
      expect(admitLedger.timeline).toEqual(["reserve", "activate", "body", "retire"])
      const parts = (yield* session.messages({ sessionID: created.id }))[0]!.parts
      expect(parts.map((part) => (part.type === "text" ? part.text : undefined))).toEqual(["replaced"])
    }),
  )

  itRefuse.instance("a fenced replace_part never enters the body, and the row is untouched", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const closure = yield* SessionClosure.Service
      const created = yield* session.create({ title: "replace-refuse" })
      const seeded = yield* seedUser(created.id, "original")

      const exit = yield* SessionMutation.leased(
        closure,
        { sessions: [created.id], kind: "replace_part" },
        replacePart(refuseLedger, seeded.part, "replaced"),
      ).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)

      // THE ORDERING CLAIM. `body` is absent, so the destructive body was never entered — the
      // refusal preceded it. An outcome-only assertion could not tell this apart from an attempted
      // write that was undone, and `activate`/`retire` are absent for the same reason: a refused
      // reservation has nothing to drive.
      expect(refuseLedger.timeline).toEqual(["reserve"])
      expect(refuseLedger.reserved).toHaveLength(1)
      expect(refuseLedger.reserved[0]!.kind).toBe("replace_part")
      expect(refuseLedger.reserved[0]!.sessions.map(String)).toEqual([created.id])

      const parts = (yield* session.messages({ sessionID: created.id }))[0]!.parts
      expect(parts.map((part) => (part.type === "text" ? part.text : undefined))).toEqual(["original"])
    }),
  )

  itRefuse.instance("the refusal is a distinct MutationRefused, not an admission refusal", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const closure = yield* SessionClosure.Service
      const created = yield* session.create({ title: "replace-refusal-type" })
      const seeded = yield* seedUser(created.id, "original")

      const exit = yield* SessionMutation.leased(
        closure,
        { sessions: [created.id], kind: "replace_part" },
        replacePart(refuseLedger, seeded.part, "replaced"),
      ).pipe(Effect.exit)

      // §6.2 gives MutationLease its own error type precisely so a revert endpoint and a prompt
      // endpoint can answer differently. Folding it into `AdmissionRefused` would make
      // "conversational execution cannot start" and "this destructive operation intersects a
      // closing branch" indistinguishable to every caller.
      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) return
      expect(JSON.stringify(exit.cause)).toContain("SessionClosureMutationRefused")
      expect(JSON.stringify(exit.cause)).not.toContain("SessionClosureAdmissionRefused")
    }),
  )

  // K52's clause is "reject at the authoritative lower/wrapper seam; UI/direct core-call bypass
  // cannot evade". A lease that lived only in `handlers/session.ts` could not satisfy it: a second
  // external caller reaching `Session` directly would simply not be guarded. `Session.replacePart`
  // is that seam, and these two tests are what make the clause checkable — the guard is exercised
  // through a DIRECT domain call, with no handler above it.
  itRefuse.instance("a direct Session.replacePart call cannot evade the guard", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "guarded-service" })
      const seeded = yield* seedUser(created.id, "original")

      const exit = yield* session
        .replacePart({ ...seeded.part, type: "text", text: "written anyway" } satisfies SessionV1.TextPart)
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(JSON.stringify(exit)).toContain("SessionClosureMutationRefused")

      // THE ORDERING CLAIM, and it is the same instrument K108 uses one layer up. `activate` is the
      // coordinator call `SessionMutation.leased` makes immediately BEFORE entering the body, so its
      // absence proves the body was never entered rather than entered and rolled back. An
      // outcome-only assertion could not tell those apart, and only the first satisfies I-22.
      expect(refuseLedger.timeline).toEqual(["reserve"])
      expect(refuseLedger.reserved).toHaveLength(1)
      expect(refuseLedger.reserved[0]!.kind).toBe("replace_part")
      expect(refuseLedger.reserved[0]!.sessions.map(String)).toEqual([created.id])

      const parts = (yield* session.messages({ sessionID: created.id }))[0]!.parts
      expect(parts.map((part) => (part.type === "text" ? part.text : undefined))).toEqual(["original"])
    }),
  )

  itAdmit.instance("positive control: an admitted Session.replacePart writes exactly what updatePart would", () =>
    Effect.gen(function* () {
      yield* reset(admitLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "guarded-service-admit" })
      const seeded = yield* seedUser(created.id, "original")

      const returned = yield* session.replacePart({
        ...seeded.part,
        type: "text",
        text: "replaced",
      } satisfies SessionV1.TextPart)

      // Without this the refusal test above could pass against a `replacePart` that never worked at
      // all. It also pins that splitting the method changed the GUARD and not the WRITE: the value
      // returned and the row persisted are what the unguarded `updatePart` produces.
      expect(admitLedger.timeline).toEqual(["reserve", "activate", "retire"])
      expect(returned).toMatchObject({ id: seeded.part.id, type: "text", text: "replaced" })
      const parts = (yield* session.messages({ sessionID: created.id }))[0]!.parts
      expect(parts.map((part) => (part.type === "text" ? part.text : undefined))).toEqual(["replaced"])
    }),
  )

  itRefuse.instance("Session.updatePart remains the unleased streaming writer, which is why K106 exists", () =>
    Effect.gen(function* () {
      yield* reset(refuseLedger)
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "unguarded-service" })
      const seeded = yield* seedUser(created.id, "original")

      // Pinning a RECORDED DESIGN DECISION, not asserting a defect — and the decision survived the
      // `replacePart` split unchanged. `updatePart` is the writer a live execution uses for parts it
      // is producing: `prompt.ts::shellImpl:682` calls it per streamed shell chunk and `processor.ts`
      // calls it at every part boundary, so leasing it wholesale would reserve a lease per chunk.
      // It therefore stays unleased, and this test is what makes that statement checkable: the
      // method really does write with a coordinator that refuses everything.
      //
      // The consequence is the premise of the whole §7.7 row. There is no service-level LEASE
      // backstop on the STREAMING writer, so K106's source-derived inventory plus per-caller
      // classification is the defence for mutation authority — it fails the build on any caller
      // nobody has classified. K86 separately reserves closure-record provenance by key; that
      // narrower guard does not reserve a mutation lease per chunk. What changed is that the
      // DESTRUCTIVE path no longer relies on the K106 premise: it has `replacePart` above.
      yield* session.updatePart({ ...seeded.part, type: "text", text: "written anyway" } satisfies SessionV1.TextPart)

      expect(refuseLedger.reserved).toEqual([])
      const parts = (yield* session.messages({ sessionID: created.id }))[0]!.parts
      expect(parts.map((part) => (part.type === "text" ? part.text : undefined))).toEqual(["written anyway"])
    }),
  )

  // K86 reserved-provenance clause. `gate6-generic-reserved-key-guard` makes the well-shaped case
  // persist; `gate6-reserved-key-is-not-a-validity-check` makes only the garbage case persist. Each
  // mutant turns both the typed-error and own-coordinate absence assertions red, while the ordinary
  // Part immediately before it remains the positive proof that this exact generic writer works.
  itAdmit.instance("rejects well-shaped and garbage reserved-key writes before their Part rows persist", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const created = yield* session.create({ title: "reserved-provenance" })
      const seeded = yield* seedUser(created.id, "ordinary source")
      const cases = [
        {
          label: "well-shaped",
          value: {
            version: 1,
            freeze_owner_operation_id: "caller-operation",
            generation: 1,
            fact_key: "self:caller-forgery",
            identity_source: "prior_user_message",
            source_user_message_id: seeded.info.id,
            record_kind: "self",
            subject_session_id: created.id,
            terminal_outcome: "cancelled",
          },
        },
        { label: "garbage", value: "caller-controlled garbage" },
      ] as const

      for (const item of cases) {
        const ordinaryID = PartID.ascending()
        const ordinary = yield* session.updatePart({
          id: ordinaryID,
          sessionID: created.id,
          messageID: seeded.info.id,
          type: "text",
          text: `positive ${item.label}`,
        })
        expect(
          yield* session.getPart({ sessionID: created.id, messageID: seeded.info.id, partID: ordinaryID }),
        ).toEqual(ordinary)

        const partID = PartID.ascending()
        const error = yield* session
          .updatePart({
            id: partID,
            sessionID: created.id,
            messageID: seeded.info.id,
            type: "text",
            // Deliberately NOT a canonical closure sentence: the key is the sole rejection route.
            text: `Caller-forged ${item.label} provenance must never persist.`,
            metadata: { [CLOSURE_RECORD_METADATA_KEY]: item.value },
          })
          .pipe(Effect.flip)

        expect(error).toBeInstanceOf(SessionNs.ReservedMetadataError)
        expect(error).toMatchObject({
          _tag: "SessionReservedMetadataError",
          key: CLOSURE_RECORD_METADATA_KEY,
          sessionID: created.id,
          messageID: seeded.info.id,
          partID,
        })
        expect(yield* session.getPart({ sessionID: created.id, messageID: seeded.info.id, partID })).toBeUndefined()
      }
    }),
  )
})

// ---------------------------------------------------------------------------
// The source-guard `closure-update-inventory.ts`'s TRACKED docstring promises.
//
// `updatePartDelta` is deliberately NOT K106-tracked. The reason is a fact about the projector, not
// a judgement about the caller: `Session.updatePartDelta` publishes `MessageV2.Event.PartDelta`
// (session.ts:1070) and NOTHING PROJECTS IT, so it produces no SQL and no durable row change and
// therefore cannot delete, replace, reorder, or alter the identity of anything a fence protects.
//
// K106 cannot guard that fact. K106 catches new CALLERS; the change that would falsify this
// disposition is someone adding a PartDelta PROJECTOR, which no caller inventory would ever see.
// Hence a separate guard, here, aimed at the projector itself.
//
// THE CLAIM WAS CHECKED, NOT INHERITED — and the inherited wording was wrong. Slice M recorded that
// the projector "projects only MessageUpdated (:263), MessageRemoved (:277), PartRemoved (:296) and
// PartUpdated (:313)". The four line cites are exact and the substantive conclusion holds, but the
// scoping is not: `projector.ts` registers 34 projectors. Four is the count that writes the V1
// `MessageTable`/`PartTable` rows; `SessionV1.Event.Created`/`Updated`/`Deleted` write the session
// row, and the remaining `SessionEvent.*` registrations write the V2 `SessionMessageTable` through
// `run`/`insertMessage` (projector.ts:113-211) — a different table family that holds no V1 Part
// evidence. So the guard below asserts the V1 subset exactly rather than a total that would be wrong
// on its face and would rot on every unrelated projector addition.
const PROJECTOR = new URL("../../../core/src/session/projector.ts", import.meta.url)
const SESSION_SOURCE = new URL("../../src/session/session.ts", import.meta.url)
const MESSAGE_V2_SOURCE = new URL("../../src/session/message-v2.ts", import.meta.url)

describe("CP-023 §7.7 — no projector consumes PartDelta, which is why `updatePartDelta` is out of scope", () => {
  test("the V1 projected-event set is exactly the seven that write V1 rows, and PartDelta is not among them", async () => {
    const source = await Bun.file(PROJECTOR).text()
    const registered = [...source.matchAll(/events\.project\(\s*([\w.]+)\s*,/g)].map((match) => match[1]!)

    // POSITIVE CONTROL, and it is doing real work. If the projector is ever restructured — a loop, a
    // table of pairs, a different registration helper — this matcher stops matching and the negative
    // assertion below would pass against an EMPTY list, certifying the disposition while inspecting
    // nothing. That is the vacuity this floor refuses. It is a floor rather than an exact total so
    // that an unrelated V2 projector addition does not fail a test about V1 Part evidence.
    expect(registered.length).toBeGreaterThan(25)

    // The V1 surface, pinned exactly. Four of these write `MessageTable`/`PartTable` — the rows a
    // fence protects — and three write the session row. A new `SessionV1.Event.*` projector is
    // precisely the change that should send its author back to this disposition, so it fails here.
    expect(registered.filter((name) => name.startsWith("SessionV1.Event."))).toEqual([
      "SessionV1.Event.Created",
      "SessionV1.Event.Updated",
      "SessionV1.Event.Deleted",
      "SessionV1.Event.MessageUpdated",
      "SessionV1.Event.MessageRemoved",
      "SessionV1.Event.PartRemoved",
      "SessionV1.Event.PartUpdated",
    ])

    // THE LOAD-BEARING NEGATIVE. Stated over the WHOLE registration set, not just the V1 subset, so
    // a PartDelta projector reached through any alias is still caught.
    expect(registered.filter((name) => name.includes("PartDelta"))).toEqual([])
  })

  test("the other leg: `updatePartDelta` really publishes PartDelta, and PartDelta really is the V1 event", async () => {
    const session = await Bun.file(SESSION_SOURCE).text()
    const messageV2 = await Bun.file(MESSAGE_V2_SOURCE).text()

    // The disposition is a conjunction and the projector half is only one side of it. If
    // `updatePartDelta` were ever changed to publish `PartUpdated`, the projected-event set above
    // would be completely unchanged and the disposition would be silently false — the delta writer
    // would be persisting rows through a projector nobody re-examined.
    expect(session).toContain("yield* events.publish(MessageV2.Event.PartDelta, input)")
    // …and `MessageV2.Event.PartDelta` is an alias of the V1 event the set above is stated over, so
    // "no PartDelta projector" and "nothing projects what updatePartDelta publishes" are the same
    // sentence rather than two claims about two different symbols.
    expect(messageV2).toContain("PartDelta: SessionV1.Event.PartDelta")

    // POSITIVE CONTROL: the same file's guarded destructive writer still publishes the event that IS
    // projected, so a file read that silently returned the wrong text cannot pass this test.
    expect(session).toContain("yield* events.publish(SessionV1.Event.PartUpdated, {")
  })
})
