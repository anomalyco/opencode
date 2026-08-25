import { describe, expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Deferred, Effect, Exit, Fiber, Layer, Queue } from "effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Workspace } from "@/control-plane/workspace"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceBootstrap as InstanceBootstrapService } from "@/project/bootstrap-service"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { Session as SessionNs } from "@/session/session"
import { SessionRevert } from "@/session/revert"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionToolPartPermit } from "@/session/toolpart-permit"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { unusedJobs } from "../lib/closure"
import { itBounded, testEffect } from "../lib/effect"
import {
  closureRecord,
  multipartPartial,
  ordinaryUser,
  persistHistoricalMessage,
  wrongTextLookalike,
} from "../lib/closure-record"
import { isCompleteClosurePair } from "@opencode-ai/core/session/closure-record"
import { SessionV1 } from "@opencode-ai/core/v1/session"

// CP-023 §18 Gate 3 step 5, and the two gaps Slice D carried into it.
//
// GAP 1 (this file's first describe). Slice D added `reserveMutation`/`activateMutation`/
// `retireMutation` to the *coordinator*, but every test in the suite stubs them —
// `Effect.die("unused")` in closure-admission and closure-permission-question, a scripted answer
// in closure-mutation and prompt.test. The pure model's `mutation.reserve` is covered by
// closure-authority-model; the coordinator wiring that reaches it is not covered anywhere. That
// is the schema-without-wiring class: the decision could be correct in the model and never
// consulted by the seam. These tests drive the REAL coordinator against a REAL fence.
//
// GAP 2 (second describe). `revert`, `unrevert`, and `cleanup` are leased but have no dedicated
// tests; they were covered only by typecheck plus the shared `leased` helper's coverage through
// `Session.remove`. `cleanup` is the highest-value of the three because it is the one that
// actually deletes rows, and it runs on EVERY ordinary prompt.

type HeldRun = { readonly input: Ports.DriverRun; readonly release: Deferred.Deferred<void> }

const capability: Ports.RunStateCapability = {
  assertNotBusy: () => Effect.void,
  cancel: () => Effect.void,
}

const heldDriver = (runs: Queue.Queue<HeldRun>): Ports.Driver => ({
  run: (input) =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      yield* Queue.offer(runs, { input, release })
      yield* Deferred.await(release)
    }),
  command: () => Effect.void,
})

const services = Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), testInstanceStoreLayer)

const withClosure = <A, E, R>(body: (runs: Queue.Queue<HeldRun>) => Effect.Effect<A, E, R | SessionClosure.Service>) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const runs = yield* Queue.unbounded<HeldRun>()
    const ports: Ports.RuntimePorts = { driver: heldDriver(runs), participants: [], hooks: {} }
    return yield* body(runs).pipe(
      Effect.provide(
        SessionClosure.layer.pipe(
          Layer.provide(SessionToolPartPermit.layer),
          Layer.provide(Ports.makeLayer(() => Effect.succeed(ports))),
        ),
      ),
      provideInstanceEffect(directory),
    )
  }).pipe(Effect.provide(services))

/** Raise a real fence over `root` by driving a real closure request to the claim point. */
const fence = Effect.fn("test.fence")(function* (
  closure: SessionClosure.Interface,
  runs: Queue.Queue<HeldRun>,
  root: SessionID,
) {
  const pending = yield* closure.request({ root, runState: capability }).pipe(Effect.forkScoped)
  const held = yield* Queue.take(runs)
  const node = Model.id("session", root)
  const claimed = yield* held.input.control.claim({
    operation: held.input.command.operation,
    proofs: [{ value: "proven_connected", root: node, active: node, path: [node], edges: [] }],
    signals: [Effect.succeed("success" as const)],
  })
  // Positive precondition for every refusal asserted downstream: the claim applied and a fence
  // for this exact session now exists. Without it a refusal could come from a misroute, a
  // location error, or a guard that refuses unconditionally.
  expect(claimed.decision).toEqual({ type: "applied" })
  expect((yield* closure.view).fences.map((item) => item.session)).toEqual([node])
  return { pending, held }
})

const release = Effect.fn("test.release")(function* (handle: {
  pending: Fiber.Fiber<unknown, unknown>
  held: HeldRun
}) {
  yield* Deferred.succeed(handle.held.release, undefined)
  yield* Fiber.join(handle.pending).pipe(Effect.exit)
})

describe("coordinator reserveMutation against a real fence (CP-023 §6.2, I-22)", () => {
  itBounded.live("drives reserved -> active -> retired for an unfenced session", () =>
    withClosure(() =>
      Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const session = SessionID.make("ses_mut_unfenced")
        const node = Model.id("session", session)

        // Positive precondition: the coordinator is reachable and holds no fence and no mutation,
        // so every observation below is attributable to this call.
        expect((yield* closure.view).fences).toEqual([])
        expect((yield* closure.view).mutations).toEqual([])

        const decision = yield* closure.reserveMutation({ sessions: [session], kind: "revert" })
        expect(decision.type).toBe("reserved")
        if (decision.type !== "reserved") return yield* Effect.die("expected a reservation")

        // Assert at each stage's own boundary. A single post-hoc read would see only `retired`
        // and could not distinguish "reserved then activated then retired" from "never activated".
        const reserved = (yield* closure.view).mutations
        expect(reserved).toHaveLength(1)
        expect(reserved[0]!.state).toBe("reserved")
        expect(reserved[0]!.kind).toBe("revert")
        expect(reserved[0]!.sessions).toEqual([node])
        // §6.2's observedEpochs: the reservation captured this session's epoch, which is what
        // lets a later release detect that a mutation was admitted against a stale view.
        expect(reserved[0]!.epochs.map((item) => item.session)).toEqual([node])

        yield* closure.activateMutation(decision.mutation)
        expect((yield* closure.view).mutations[0]!.state).toBe("active")

        yield* closure.retireMutation(decision.mutation)
        expect((yield* closure.view).mutations[0]!.state).toBe("retired")
      }),
    ),
  )

  itBounded.live("refuses a reservation whose scope is fenced, and reports the fence as the reason", () =>
    withClosure((runs) =>
      Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const session = SessionID.make("ses_mut_fenced")

        // Positive precondition: this exact call, through this exact seam, reserves BEFORE the
        // fence exists. Without it the refusal below could come from a seam that always refuses.
        const before = yield* closure.reserveMutation({ sessions: [session], kind: "revert_cleanup" })
        expect(before.type).toBe("reserved")
        if (before.type === "reserved") yield* closure.retireMutation(before.mutation)

        const handle = yield* fence(closure, runs, session)

        const after = yield* closure.reserveMutation({ sessions: [session], kind: "revert_cleanup" })
        expect(after.type).toBe("refused")
        if (after.type !== "refused") return yield* Effect.die("expected a refusal")
        expect(after.reason).toBe("fenced")

        yield* release(handle)
      }),
    ),
  )

  itBounded.live("refuses a subtree reservation when ANY scoped session is fenced", () =>
    withClosure((runs) =>
      Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const fenced = SessionID.make("ses_mut_subtree_fenced")
        const clean = SessionID.make("ses_mut_subtree_clean")

        const handle = yield* fence(closure, runs, fenced)

        // Positive control: the unfenced member is admissible on its own, so the subtree refusal
        // below is attributable to the fenced member and not to the scope being a list.
        const solo = yield* closure.reserveMutation({ sessions: [clean], kind: "remove_session" })
        expect(solo.type).toBe("reserved")
        if (solo.type === "reserved") yield* closure.retireMutation(solo.mutation)

        // The load-bearing claim behind Slice D's one-lease-per-subtree decision: the whole
        // subtree is decided atomically, so a partially-deleted subtree is unreachable.
        const subtree = yield* closure.reserveMutation({ sessions: [clean, fenced], kind: "remove_session" })
        expect(subtree.type).toBe("refused")
        if (subtree.type !== "refused") return yield* Effect.die("expected a refusal")
        expect(subtree.reason).toBe("fenced")

        yield* release(handle)
      }),
    ),
  )
})

// ---------------------------------------------------------------------------
// The revert/unrevert/cleanup seams.
//
// A recording coordinator rather than the real one: what needs proving HERE is the seam's own
// behaviour — that the lease is taken before destruction, with the right scope and kind, and that
// a refusal stops the destruction entirely. The real coordinator's refusal logic is proved in the
// describe above, against a real fence. Driving both through one pipeline could not distinguish a
// defect in one from a defect in the other.
//
// These stay on the unbounded runner rather than `itBounded`: the 3s FIBER_BOUND is calibrated
// against the pure-model and coordinator bodies, and these build a tmpdir instance with a real
// database, snapshot, and projector. They also fork no fibers, so the never-settles failure mode
// the bound exists to catch is not reachable here.
// ---------------------------------------------------------------------------

type MutationCalls = {
  reserved: { readonly sessions: readonly SessionID[]; readonly kind: string }[]
  activated: Model.MutationID[]
  retired: Model.MutationID[]
}

const admitCalls: MutationCalls = { reserved: [], activated: [], retired: [] }
const refuseCalls: MutationCalls = { reserved: [], activated: [], retired: [] }

const reset = (calls: MutationCalls) =>
  Effect.sync(() => {
    calls.reserved.length = 0
    calls.activated.length = 0
    calls.retired.length = 0
  })

const recordingClosure = (calls: MutationCalls, admit: boolean) =>
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
          calls.reserved.push({ sessions: input.sessions, kind: input.kind })
          if (!admit) return { type: "refused" as const, reason: "fenced" as const }
          return { type: "reserved" as const, mutation: Model.id("mutation", `mutation_${calls.reserved.length}`) }
        }),
      activateMutation: (mutation) => Effect.sync(() => void calls.activated.push(mutation)),
      retireMutation: (mutation) => Effect.sync(() => void calls.retired.push(mutation)),
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
 * instance to test bodies.
 *
 * `InstanceStore` belongs in this group rather than beside it. Compiled separately it hands `Session`
 * a different `Database` than the one the test's own reads resolve, and nothing reports the mismatch
 * — created sessions simply read as absent.
 */
const harness = (closure: Layer.Layer<SessionClosure.Service>) => {
  return testEffect(
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
        SessionRevert.node,
        Snapshot.node,
        SessionProjector.node,
      ]),
      [
        [InstanceStore.bootstrapNode, noopBootstrapLayer],
        [SessionClosure.node, closure],
        [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      ],
    ),
  )
}

const itAdmit = harness(recordingClosure(admitCalls, true))
const itRefuse = harness(recordingClosure(refuseCalls, false))

const message = Effect.fn("test.message")(function* (sessionID: SessionID) {
  const session = yield* SessionNs.Service
  const message = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user" as const,
    sessionID,
    agent: "default",
    model: { providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-4") },
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: message.id,
    type: "text",
    text: "test message",
  })
  return message
})

const persist = Effect.fn("test.persist")((message: SessionV1.WithParts) => persistHistoricalMessage(message))

describe("SessionRevert.cleanup destructive-mutation lease (CP-023 §7.7)", () => {
  itAdmit.instance("takes exactly one revert_cleanup lease and deletes the post-boundary rows", () =>
    Effect.gen(function* () {
      yield* reset(admitCalls)
      const sessions = yield* SessionNs.Service
      const revert = yield* SessionRevert.Service
      const created = yield* sessions.create({ title: "cleanup-admit" })

      const keep = yield* message(created.id)
      const boundary = yield* message(created.id)
      const sweep = yield* message(created.id)
      yield* sessions.setRevert({ sessionID: created.id, revert: { messageID: boundary.id }, summary: undefined })

      // Positive precondition: all three rows exist before cleanup, so the survivor asserted
      // below is a row that outlived a real deletion rather than an empty transcript.
      expect((yield* sessions.messages({ sessionID: created.id })).map((item) => item.info.id)).toEqual([
        keep.id,
        boundary.id,
        sweep.id,
      ])

      yield* revert.cleanup(yield* sessions.get(created.id))

      // The hazard site itself. `cleanupAdmitted` sweeps the boundary message AND everything
      // after it (with no `partID` the boundary row is pushed onto `remove` at revert.ts:234),
      // while the pre-boundary row survives. Asserting a survivor as well as the deletions is
      // what makes this a scope assertion rather than "cleanup emptied the session".
      expect((yield* sessions.messages({ sessionID: created.id })).map((item) => item.info.id)).toEqual([keep.id])

      // One lease for the whole cleanup, not one per removed row: §7.7's "Consume one
      // summarize/revert mutation lease across the whole cleanup".
      expect(admitCalls.reserved).toHaveLength(1)
      expect(admitCalls.reserved[0]!.kind).toBe("revert_cleanup")
      expect(admitCalls.reserved[0]!.sessions).toEqual([created.id])
      expect(admitCalls.activated).toHaveLength(1)
      expect(admitCalls.retired).toEqual(admitCalls.activated)
    }),
  )

  itRefuse.instance("refuses before deleting anything, so a fenced session keeps its transcript", () =>
    Effect.gen(function* () {
      yield* reset(refuseCalls)
      const sessions = yield* SessionNs.Service
      const revert = yield* SessionRevert.Service
      const created = yield* sessions.create({ title: "cleanup-refuse" })

      const keep = yield* message(created.id)
      const boundary = yield* message(created.id)
      const sweep = yield* message(created.id)
      yield* sessions.setRevert({ sessionID: created.id, revert: { messageID: boundary.id }, summary: undefined })

      const exit = yield* revert.cleanup(yield* sessions.get(created.id)).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)

      // Admission was consulted for this exact session, and BOTH rows the admitting control above
      // proves are deletable are still here. That pairing is what makes this a refusal rather than
      // a cleanup that happened to find nothing to do.
      expect(refuseCalls.reserved).toHaveLength(1)
      expect(refuseCalls.reserved[0]!.kind).toBe("revert_cleanup")
      expect((yield* sessions.messages({ sessionID: created.id })).map((item) => item.info.id)).toEqual([
        keep.id,
        boundary.id,
        sweep.id,
      ])

      // Refusal precedes destruction, so there is nothing to activate and nothing to retire.
      expect(refuseCalls.activated).toEqual([])
      expect(refuseCalls.retired).toEqual([])

      // The revert boundary survives too: `clearRevert` is the last statement of the leased body,
      // so a refusal that ran the body partially would still have cleared it.
      expect((yield* sessions.get(created.id)).revert?.messageID).toBe(boundary.id)
    }),
  )

  itRefuse.instance("reserves nothing at all when there is no revert boundary to clean", () =>
    Effect.gen(function* () {
      yield* reset(refuseCalls)
      const sessions = yield* SessionNs.Service
      const revert = yield* SessionRevert.Service
      const created = yield* sessions.create({ title: "cleanup-noop" })
      yield* message(created.id)

      // `if (!session.revert) return` sits AHEAD of the lease deliberately: no boundary means no
      // deletion, so there is nothing to protect — and cleanup runs on every ordinary prompt, so
      // reserving here would put a destructive-mutation lease on the common path. A refusing
      // coordinator makes that checkable: if the guard moved below the lease this call would fail.
      yield* revert.cleanup(yield* sessions.get(created.id))
      expect(refuseCalls.reserved).toEqual([])
    }),
  )
})

describe("SessionRevert.revert and unrevert destructive-mutation leases (CP-023 §7.7)", () => {
  itAdmit.instance("leases revert on the exact session scope and settles the lease", () =>
    Effect.gen(function* () {
      yield* reset(admitCalls)
      const sessions = yield* SessionNs.Service
      const revert = yield* SessionRevert.Service
      const created = yield* sessions.create({ title: "revert-admit" })
      const first = yield* message(created.id)

      yield* revert.revert({ sessionID: created.id, messageID: first.id })

      expect(admitCalls.reserved).toHaveLength(1)
      expect(admitCalls.reserved[0]!.kind).toBe("revert")
      expect(admitCalls.reserved[0]!.sessions).toEqual([created.id])
      expect(admitCalls.activated).toHaveLength(1)
      expect(admitCalls.retired).toEqual(admitCalls.activated)
    }),
  )

  itRefuse.instance("refuses revert before any revert state is written", () =>
    Effect.gen(function* () {
      yield* reset(refuseCalls)
      const sessions = yield* SessionNs.Service
      const revert = yield* SessionRevert.Service
      const created = yield* sessions.create({ title: "revert-refuse" })
      const first = yield* message(created.id)

      // Positive precondition: no revert state exists yet, so the assertion after the refusal is
      // about a write that did not happen rather than a field that was never going to change.
      expect((yield* sessions.get(created.id)).revert).toBeUndefined()

      const exit = yield* revert.revert({ sessionID: created.id, messageID: first.id }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)

      expect(refuseCalls.reserved).toHaveLength(1)
      expect(refuseCalls.reserved[0]!.kind).toBe("revert")
      expect((yield* sessions.get(created.id)).revert).toBeUndefined()
      expect(refuseCalls.activated).toEqual([])
    }),
  )

  itRefuse.instance("refuses unrevert without clearing the revert boundary", () =>
    Effect.gen(function* () {
      yield* reset(refuseCalls)
      const sessions = yield* SessionNs.Service
      const revert = yield* SessionRevert.Service
      const created = yield* sessions.create({ title: "unrevert-refuse" })
      const first = yield* message(created.id)
      yield* sessions.setRevert({ sessionID: created.id, revert: { messageID: first.id }, summary: undefined })

      // Positive precondition: the boundary the refusal must preserve is actually set.
      expect((yield* sessions.get(created.id)).revert?.messageID).toBe(first.id)

      const exit = yield* revert.unrevert({ sessionID: created.id }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)

      expect(refuseCalls.reserved).toHaveLength(1)
      expect(refuseCalls.reserved[0]!.kind).toBe("unrevert")
      // `unrevertAdmitted` ends in `clearRevert`, so a body that ran despite the refusal would
      // have erased this.
      expect((yield* sessions.get(created.id)).revert?.messageID).toBe(first.id)
      expect(refuseCalls.activated).toEqual([])
    }),
  )

  // K88 direct-SessionRevert boundary clause. Mutant: treat the genuine pair as an ordinary User
  // boundary or reject key-bearing controls; red: closure mutates/reserves, or malformed controls stop
  // reaching the ordinary revert path.
  itAdmit.instance("rejects a complete closure Message or sole Part before mutation reservation", () =>
    Effect.gen(function* () {
      yield* reset(admitCalls)
      const sessions = yield* SessionNs.Service
      const revert = yield* SessionRevert.Service
      const created = yield* sessions.create({ title: "closure-boundary" })
      const real = yield* persist(
        ordinaryUser({ sessionID: created.id, messageID: MessageID.ascending(), partID: PartID.ascending() }),
      )
      const synthetic = yield* persist(
        ordinaryUser({
          sessionID: created.id,
          messageID: MessageID.ascending(),
          partID: PartID.ascending(),
          synthetic: true,
        }),
      )
      const lookalike = yield* persist(
        wrongTextLookalike({ sessionID: created.id, messageID: MessageID.ascending(), partID: PartID.ascending() }),
      )
      const partial = yield* persist(
        multipartPartial({ sessionID: created.id, messageID: MessageID.ascending(), partID: PartID.ascending() }),
      )
      const closure = yield* persist(
        closureRecord({ sessionID: created.id, messageID: MessageID.ascending(), partID: PartID.ascending() }),
      )

      expect(isCompleteClosurePair(closure)).toBe(true)
      expect([real, synthetic, lookalike, partial].map(isCompleteClosurePair)).toEqual([false, false, false, false])
      const part = closure.parts[0]!
      for (const input of [
        { sessionID: created.id, messageID: closure.info.id },
        { sessionID: created.id, messageID: closure.info.id, partID: part.id },
      ]) {
        const error = yield* revert.revert(input).pipe(Effect.flip)
        expect(error).toBeInstanceOf(SessionNs.BoundaryError)
        if (!(error instanceof SessionNs.BoundaryError)) throw error
        expect(error.reason).toBe("closure_record")
        expect(admitCalls.reserved).toEqual([])
        expect((yield* sessions.get(created.id)).revert).toBeUndefined()
      }

      for (const boundary of [synthetic, lookalike, partial]) {
        yield* revert.revert({ sessionID: created.id, messageID: boundary.info.id })
        expect(admitCalls.reserved.at(-1)?.kind).toBe("revert")
        expect((yield* sessions.get(created.id)).revert?.messageID).toBe(boundary.info.id)
        yield* sessions.clearRevert(created.id)
      }
    }),
  )

  // K88 revert latest-conversational-boundary clause. Mutant: let the closure User become `lastUser`;
  // red: the normalized boundary becomes the closure instead of the latest generic User control.
  itAdmit.instance("normalizes a later Part boundary onto the latest non-closure User", () =>
    Effect.gen(function* () {
      yield* reset(admitCalls)
      const sessions = yield* SessionNs.Service
      const revert = yield* SessionRevert.Service
      const created = yield* sessions.create({ title: "closure-last-user" })
      const real = yield* persist(
        ordinaryUser({ sessionID: created.id, messageID: MessageID.ascending(), partID: PartID.ascending() }),
      )
      const synthetic = yield* persist(
        ordinaryUser({
          sessionID: created.id,
          messageID: MessageID.ascending(),
          partID: PartID.ascending(),
          synthetic: true,
        }),
      )
      const lookalike = yield* persist(
        wrongTextLookalike({ sessionID: created.id, messageID: MessageID.ascending(), partID: PartID.ascending() }),
      )
      const partial = yield* persist(
        multipartPartial({ sessionID: created.id, messageID: MessageID.ascending(), partID: PartID.ascending() }),
      )
      const closure = yield* persist(
        closureRecord({ sessionID: created.id, messageID: MessageID.ascending(), partID: PartID.ascending() }),
      )
      const assistantID = MessageID.ascending()
      const boundaryID = PartID.ascending()
      yield* sessions.updateMessage({
        id: assistantID,
        role: "assistant",
        sessionID: created.id,
        parentID: closure.info.id,
        agent: "default",
        mode: "default",
        providerID: ProviderV2.ID.make("openai"),
        modelID: ModelV2.ID.make("gpt-4"),
        path: { cwd: "/", root: "/" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now() },
      })
      yield* sessions.updatePart({
        id: boundaryID,
        sessionID: created.id,
        messageID: assistantID,
        type: "text",
        text: "assistant boundary",
      })

      expect([real, synthetic, lookalike, partial].map(isCompleteClosurePair)).toEqual([false, false, false, false])
      expect(isCompleteClosurePair(closure)).toBe(true)
      yield* revert.revert({ sessionID: created.id, messageID: assistantID, partID: boundaryID })
      expect((yield* sessions.get(created.id)).revert?.messageID).toBe(partial.info.id)
      expect((yield* sessions.get(created.id)).revert?.messageID).not.toBe(closure.info.id)
    }),
  )
})
