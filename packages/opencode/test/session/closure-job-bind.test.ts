import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Exit, Layer, Option, Queue } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { AttachmentContract } from "@/session/attachment/contract"
import { BackgroundJob } from "@/background/job"
import { noAnswer } from "../lib/background"
import { AttachmentCoordinator } from "@/session/attachment/coordinator"
import { AttachmentParticipant } from "@/session/attachment/participant"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionToolPartPermit } from "@/session/toolpart-permit"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { SessionRunState } from "@/session/run-state"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { itBounded as it } from "../lib/effect"

/**
 * The coordinator half of the bind-before-arm protocol.
 *
 * Everything here is proved against the real coordinator and the real model - `realClosure` builds
 * `SessionClosure.layer` itself - with only the driver scripted, because the driver is what lets a
 * fence be held mid-flight. Every test but the last calls the coordinator directly and touches no
 * BackgroundJob registry. That separation is deliberate: proving the coordinator's answers on their
 * own is what makes connecting the two checkable, rather than wiring two unproved halves together
 * and testing only the composition.
 *
 * The final test is the end-to-end proof and deliberately breaks that rule, because once both
 * halves are proved the remaining risk is the join itself - and nothing else in the codebase
 * exercises a real admission through the registry to a real coordinator.
 *
 * Covered: a bind after the fence is cancellation-owned with no escape, both orderings of the
 * permit compare-and-set, and the epoch and stale-handle rejections.
 */

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

const statusStub = Layer.succeed(
  SessionStatus.Service,
  SessionStatus.Service.of({
    get: () => Effect.succeed({ type: "idle" as const }),
    list: () => Effect.succeed(new Map()),
    set: () => Effect.void,
  }),
)

const services = Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), testInstanceStoreLayer)

const withRunState = <A, E, R>(
  closure: Layer.Layer<SessionClosure.Service, never, never>,
  body: (directory: string) => Effect.Effect<A, E, R | SessionRunState.Service | SessionClosure.Service>,
) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    // The group exposes SessionClosure to the body alongside SessionRunState, and the override list
    // pins the one closure instance. That single instance is the point: SessionRunState declares
    // BackgroundJob among its dependencies, so the job binder and the admission seam resolve the
    // same coordinator. Two instances and the binder is asked about a lease its coordinator never
    // issued, which surfaces as a refusal rather than as a wiring error.
    const runState = LayerNode.compile(
      LayerNode.group([SessionRunState.node, BackgroundJob.node, SessionClosure.node, SessionStatus.node]),
      [
        [SessionClosure.node, closure],
        [SessionStatus.node, statusStub],
      ],
    )
    return yield* body(directory).pipe(Effect.provide(runState), provideInstanceEffect(directory))
  }).pipe(Effect.provide(services))

const realClosure = (ports: Ports.RuntimePorts) =>
  SessionClosure.layer.pipe(
    Layer.provide(SessionToolPartPermit.layer),
    Layer.provide(Ports.makeLayer(() => Effect.succeed(ports))),
  )

const inflightPorts = () =>
  Effect.gen(function* () {
    const runs = yield* Queue.unbounded<HeldRun>()
    const ports: Ports.RuntimePorts = { driver: heldDriver(runs), participants: [], hooks: {} }
    return { runs, ports }
  })

const raiseFence = (
  closure: SessionClosure.Interface,
  runs: Queue.Queue<HeldRun>,
  root: SessionID,
  node: Model.SessionID,
) =>
  Effect.gen(function* () {
    const pending = yield* closure.request({ root, runState: capability }).pipe(Effect.forkScoped)
    const held = yield* Queue.take(runs)
    const claimed = yield* held.input.control.claim({
      operation: held.input.command.operation,
      proofs: [{ value: "proven_connected", root: node, active: node, path: [node], edges: [] }],
      signals: [Effect.succeed("success" as const)],
    })
    expect(claimed.decision).toEqual({ type: "applied" })
    expect((yield* closure.view).fences.map((item) => item.session)).toEqual([node])
    return { pending, held }
  })

const holdLease = (closure: SessionClosure.Interface, session: SessionID, tag: string) =>
  Effect.gen(function* () {
    const signal = yield* Deferred.make<void>()
    const decision = yield* closure.acquire({
      session,
      origin: "internal",
      retry: "initial",
      source: `test.g4.${tag}`,
      owner: { id: Model.id("scope", `g4:${tag}`), signal },
    })
    expect(decision.type).toBe("admitted")
    if (decision.type !== "admitted") return yield* Effect.die("expected an admission")
    return { lease: decision.lease, epoch: decision.epoch }
  })

const coordinates = (tag: string) => ({
  request: Model.id("request", `request_${tag}`),
  job: Model.id("job", `job_${tag}`),
  lifetime: Model.id("lifetime", `lifetime_${tag}`),
  scope: Model.id("scope", `jobscope_${tag}`),
})

const jobOf = (view: Model.View, tag: string) => view.jobs.find((item) => item.id === Model.id("job", `job_${tag}`))

const fencePayload = (subjects: readonly SessionID[]) => ({
  fences: subjects.map((subject) => ({
    subject,
    ref: Object.freeze(Object.create(null)) as Ports.ParticipantFenceRef,
  })),
})

describe("SessionClosure job bind", () => {
  it.live("an unfenced lease binds sequence zero and issues exactly one permit", () =>
    Effect.gen(function* () {
      const { ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g4_arm")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const held = yield* holdLease(closure, root, "arm")
          const ids = coordinates("arm")

          const outcome = yield* closure.jobStart({ ...ids, lease: held.lease, epoch: held.epoch })

          expect(outcome.type).toBe("arm_allowed")
          if (outcome.type !== "arm_allowed") return
          // Sequence zero: the base invocation arms before any extension.
          expect(outcome.sequence).toBe(0n)

          const view = yield* closure.view
          const permits = view.armPermits.filter((item) => item.lifetime === ids.lifetime)
          expect(permits).toHaveLength(1)
          expect(permits[0]?.state).toBe("issued")
          expect(permits[0]?.id).toBe(outcome.permit)
          expect(permits[0]?.sequence).toBe(0n)
          // the token is `binding`, NOT yet `armed`. Arming is the registry's consume, which
          // has not happened - so a bind that stopped here must leave no armed lifetime behind.
          expect(jobOf(view, "arm")?.state).toBe("binding")
        }),
      )
    }),
  )

  it.live("a bind whose lease a fence has adopted is cancellation-owned with no escape", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g4_k8a")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const held = yield* holdLease(closure, root, "k8a")
          const ids = coordinates("k8a")

          // A real fence through the real claim path, not a scripted refusal. The two diverge, and
          // only the real path reflects production.
          const fence = yield* raiseFence(closure, runs, root, node)

          const outcome = yield* closure.jobStart({ ...ids, lease: held.lease, epoch: held.epoch })

          expect(outcome.type).toBe("cancellation_owned")

          const view = yield* closure.view
          // "No escape" is the assertion that matters: not merely that the answer was refused, but
          // that nothing armable survives it. No permit was minted, and the terminal token was reaped.
          expect(view.armPermits.filter((item) => item.lifetime === ids.lifetime)).toHaveLength(0)
          expect(jobOf(view, "k8a")).toBeUndefined()

          yield* Deferred.succeed(fence.held.release, undefined)
        }),
      )
    }),
  )

  it.live("a real attachment scope captures then cancels against the same core contract", () =>
    /**
     * The companion to the test above, which proves the same core contract with a fake participant.
     *
     * This is not a variant of it. Participants are dispatched by the driver, never by `jobStart`,
     * so swapping the fake for the real adapter changes nothing about that test. What this one adds
     * is that a real `AttachmentCoordinator` scope — one holding live reserved and attached state —
     * captures without destruction, then makes its cancellation transition after core's physical
     * signal, while core's answer is unchanged: `cancellation_owned`, no arm permit minted, token
     * terminal.
     *
     * Both halves are asserted because they fail independently. Core could refuse the bind while
     * the scope kept believing its work was still admitted, or the scope could cancel while core
     * still minted an armable permit. Neither implies the other, and only asserting both gives
     * "against the same core contract" any content.
     *
     * There is no per-sequence winner, which is why the `cancel` fact is keyed by subject rather
     * than by lifetime-plus-sequence. The scope is cancelled once, and the reservation attached
     * before the fence does not acquire a second, independent outcome of its own.
     */
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g8_k8b")
      const node = Model.id("session", root)
      const child = SessionID.make("ses_g8_k8b_child")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.Service
          const participant = AttachmentParticipant.make(coordinator)

          // Real attachment state: a scope that has reserved and attached a job, so there is something
          // live for the bind to be cancelled against rather than an empty scope that would report
          // "cancelled" for the trivial reason that it never held anything.
          const scope = yield* coordinator.open(child)
          const reservation = yield* scope.reserve(SessionID.make("ses_g8_k8b_job"))
          expect((yield* scope.claimObserver(reservation)).type).toBe("owner")
          expect(scope.current().cancelled).toBe(false)

          const closure = yield* SessionClosure.Service
          const held = yield* holdLease(closure, root, "k8b")
          const ids = coordinates("k8b")
          const fence = yield* raiseFence(closure, runs, root, node)

          // ---- core's contract, identical to the fake-participant case above ----
          const outcome = yield* closure.jobStart({ ...ids, lease: held.lease, epoch: held.epoch })
          expect(outcome.type).toBe("cancellation_owned")
          const view = yield* closure.view
          expect(view.armPermits.filter((item) => item.lifetime === ids.lifetime)).toHaveLength(0)
          expect(jobOf(view, "k8b")).toBeUndefined()

          // ---- the attachment scope's own transition, driven through the real adapter ----
          const call = (kind: "claim" | "cancel", payload: unknown) => ({
            kind,
            participant: AttachmentParticipant.ID,
            operation: Model.id("operation", "operation_k8b"),
            repair: Model.id("repair", "repair_k8b"),
            operationRevision: 0n,
            participantRevision: 0n,
            payload,
          })
          const payload = fencePayload([child])
          const claimed = yield* participant.claim(call("claim", payload))
          expect(claimed.value).toEqual([{ type: "participant_claim", subject: child, claim: "held" }])
          expect(scope.current().cancelled).toBe(false)

          // Core dispatches physical interruption between these exchanges. The receipt then names
          // the same SUBJECT and performs destructive local cancellation once. A
          // per-sequence winner would have to appear as a second, differently-keyed fact here.
          const cancelled = yield* participant.cancel(
            call("cancel", { cancels: [{ subject: child, outcome: "interrupted", ref: payload.fences[0]!.ref }] }),
          )
          expect(cancelled.value).toEqual([{ type: "participant_cancel", subject: child, outcome: "interrupted" }])
          expect(scope.current().cancelled).toBe(true)

          yield* Deferred.succeed(fence.held.release, undefined)
        }).pipe(Effect.provide(AttachmentCoordinator.layer)),
      )
    }),
  )

  it.live("a fenced scope refuses at all four attachment lifecycle positions, with no fallback clearance", () =>
    /**
     * A fence is applied at each of the four attachment lifecycle positions - reservation,
     * admission, outcome processing, and response eligibility - and each is checked for generic
     * participant facts, cancel/unknown truth, and the absence of any fallback clearance.
     *
     * Every position gets a positive precontrol, because "it refused" is worthless unless the
     * position was open a moment earlier. The scope reserves a job, elects its observer, moves its
     * terminal outcome, settles it after the represented parent response, and records a clean
     * candidate before the fence. Each later refusal is therefore the fence's doing rather than a
     * lifecycle position that never worked.
     *
     * Response eligibility needs a real candidate to be observable at all. The contract exposes
     * bounded candidate presence, and the coordinator's own tests prove its clearance. This asks
     * whether cancellation clears that candidate and stops a later clean turn from restoring
     * response eligibility.
     *
     * What this does NOT prove, stated so it is not read as more than it is: these four positions
     * are not four independent guards. Each does test `state.cancelled` at its own site, so the
     * obvious reading is that each falsifies separately. It does not. Removing the `cancelled` term
     * from `reserve`, `claimObserver` or `terminal` individually leaves this test green, because
     * the later `claimCancellation` receipt atomically clears the substrate those positions read:
     * `state.jobs.clear()` makes observer election and terminal processing refuse through
     * `jobs.get(...) === undefined`, while candidate clearing independently blocks response
     * eligibility. The refusals survive an individual guard's removal by a second route.
     *
     * The single guard this actually pins is `claimCancellation`'s own entry, reached by
     * participant `cancel`. The test earns its cost - it proves all four positions are gated on
     * cancellation and that no fallback path clears any of them - but a change that weakens one
     * position's own guard will not be caught here.
     */
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g8_k27")
      const node = Model.id("session", root)
      const child = SessionID.make("ses_g8_k27_child")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.Service
          const participant = AttachmentParticipant.make(coordinator)
          const scope = yield* coordinator.open(child)

          // ---- POSITIVE PRECONTROLS: observer, terminal marker, settlement, and candidate ----
          const live = yield* scope.reserve(SessionID.make("ses_g8_k27_live"))
          expect((yield* scope.claimObserver(live)).type).toBe("owner")
          const messageID = MessageID.ascending()
          const partID = PartID.ascending()
          const envelope = "k27-envelope"
          const item = yield* scope.terminal(live)
          expect(item).toBeTruthy()
          const message = {
            info: { id: messageID, sessionID: child, role: "assistant" },
            parts: [{ id: partID, messageID, sessionID: child, type: "text", text: envelope }],
          } as unknown as SessionV1.WithParts
          yield* scope.settleTerminal(item!)
          yield* scope.observeTurn({ assistant: message, clean: true })
          expect(scope.current()).toMatchObject({ undelivered: 0, candidate: true })

          // ---- core captures, then represented physical signalling, then participant cancel ----
          const closure = yield* SessionClosure.Service
          const held = yield* holdLease(closure, root, "k27")
          const fence = yield* raiseFence(closure, runs, root, node)
          const payload = fencePayload([child])
          const claimed = yield* participant.claim({
            kind: "claim",
            participant: AttachmentParticipant.ID,
            operation: Model.id("operation", "operation_k27"),
            repair: Model.id("repair", "repair_k27"),
            operationRevision: 0n,
            participantRevision: 0n,
            payload,
          })
          // The generic participant fact is the truth core sees: a claim is HELD for this subject.
          expect(claimed.value).toEqual([{ type: "participant_claim", subject: child, claim: "held" }])
          expect(scope.current().cancelled).toBe(false)
          yield* participant.cancel({
            kind: "cancel",
            participant: AttachmentParticipant.ID,
            operation: Model.id("operation", "operation_k27"),
            repair: Model.id("repair", "repair_k27"),
            operationRevision: 0n,
            participantRevision: claimed.revision,
            payload: { cancels: [{ subject: child, outcome: "interrupted", ref: payload.fences[0]!.ref }] },
          })
          expect(scope.current().cancelled).toBe(true)

          // ---- 1. RESERVATION ----
          const late = yield* scope.reserve(SessionID.make("ses_g8_k27_late")).pipe(Effect.exit)
          expect(Exit.isFailure(late)).toBe(true)

          // ---- 2. OBSERVER ADMISSION ----
          expect(yield* scope.claimObserver(live)).toEqual({ type: "unavailable", reason: "cancelled" })

          // ---- 3. OUTCOME-PROCESSING ----
          expect(yield* scope.terminal(live)).toBeUndefined()

          // ---- 4. RESPONSE-ELIGIBILITY ----
          yield* scope.observeTurn({ assistant: message, clean: true })

          // Cancellation suppresses eligibility and clears the pre-fence candidate.
          expect(scope.current()).toMatchObject({ candidate: false, cancelled: true })
          yield* scope.finishContinuation()

          yield* Deferred.succeed(fence.held.release, undefined)
        }).pipe(Effect.provide(AttachmentCoordinator.layer)),
      )
    }),
  )

  it.live("a fenced scope's result is cancellation-owned and its DUE wake cannot start a provider turn", () =>
    /**
     * Two properties of the result-and-wake race are proved here: a fenced scope's result is
     * suppressed and cancellation-owned, and a due wake cannot start a provider turn.
     *
     * A third - participant quiescence blocking release until observer state clears - is
     * deliberately not claimed here. `gate()` withholds a resolution while `state.active > 0`, which
     * `attachment-coordinator.test.ts` exercises through `finishContinuation` followed by `result`,
     * and the rest is carried by the core continuation lease. Asserting it here would name more than
     * this test establishes.
     *
     * The wake precontrol is the point of the setup, not scene-setting. `needsWake()` is a
     * conjunction of eight terms, so a scope in any ordinary state answers `false` for reasons that
     * have nothing to do with a fence - and asserting `false` after the fence would pass against a
     * scope that could never have woken. The reserve/claimObserver/terminal/settle sequence drives
     * the scope to the exact state where a wake is genuinely due (`everAttached`, no live jobs, no
     * undelivered outcome, no clean candidate), and that is asserted before the fence lands. Only
     * then does `false` afterwards mean anything.
     *
     * `result` is read under a bound, and the bound carries information rather than merely
     * protecting the suite. Cancellation ownership arrives through `gate()`, which `apply()` runs
     * after every transition and which converts a cancelled scope into a `status: "cancelled"`
     * resolution. Without it `result` does not fail - it finds no resolution, cannot take its
     * immediate-success branch because the scope has attached, and blocks on the completion
     * Deferred. Failing fast and blocking forever are the two outcomes worth distinguishing, and an
     * unbounded read would turn the second into a hung suite instead of a failure.
     *
     * The untouched-scope control exists because "result failed" is weak evidence alone. A second
     * scope that never attached resolves its caller's fallback immediately through the same code
     * path, establishing that `result` can answer at all and that the failure below belongs to the
     * cancellation rather than to a `result` that never returns anything.
     *
     * What the wake clause does NOT prove independently: after cancellation `needsWake()` is blocked
     * by two separate terms - `!state.cancelled`, and `!state.resolution`, the latter true only
     * because `gate()` converted the cancellation into a resolution. Either alone still blocks the
     * wake, so this pins the pair jointly with the cancellation receipt rather than the guard on its
     * own. Its non-vacuity comes from the precontrol instead, which is why the precontrol is not
     * optional here.
     *
     * This is the same shape as the four-position test above, in a second form. There, the positions
     * are covered by cleared substrate: participant cancel reaches `claimCancellation`, which empties
     * the maps those positions read. Here, the wake is covered by derived state: the cancellation
     * produces a resolution, which blocks it a second time. Both descend from the cancellation
     * transition being atomic, but one removes inputs and the other adds a consequence, so knowing
     * the first form does not predict the second.
     */
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g8_k40")
      const node = Model.id("session", root)
      const child = SessionID.make("ses_g8_k40_child")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.Service
          const participant = AttachmentParticipant.make(coordinator)

          const speech = (session: SessionID, body: string) => {
            const messageID = MessageID.ascending()
            const partID = PartID.ascending()
            return {
              info: { id: messageID, sessionID: session, role: "assistant" },
              parts: [{ id: partID, messageID, sessionID: session, type: "text", text: body }],
            } as unknown as SessionV1.WithParts
          }

          // ---- CONTROL: `result` can answer a caller at all ----
          const spare = SessionID.make("ses_g8_k40_spare")
          const untouched = yield* coordinator.open(spare)
          const control = yield* untouched.result(speech(spare, "plain fallback"))
          expect(control).toMatchObject({ type: "evidence", fallback: { parts: [{ text: "plain fallback" }] } })

          // ---- PRECONTROL: drive the scope to the state where a wake is genuinely DUE ----
          const scope = yield* coordinator.open(child)
          const live = yield* scope.reserve(SessionID.make("ses_g8_k40_live"))
          expect((yield* scope.claimObserver(live)).type).toBe("owner")
          const item = yield* scope.terminal(live)
          expect(item).toBeTruthy()
          yield* scope.settleTerminal(item!)
          expect(scope.needsWake()).toBe(true)

          // ---- core captures, then represented physical signalling, then participant cancel ----
          const closure = yield* SessionClosure.Service
          yield* holdLease(closure, root, "k40")
          const fence = yield* raiseFence(closure, runs, root, node)
          const payload = fencePayload([child])
          yield* participant.claim({
            kind: "claim",
            participant: AttachmentParticipant.ID,
            operation: Model.id("operation", "operation_k40"),
            repair: Model.id("repair", "repair_k40"),
            operationRevision: 0n,
            participantRevision: 0n,
            payload,
          })
          expect(scope.current().cancelled).toBe(false)
          yield* participant.cancel({
            kind: "cancel",
            participant: AttachmentParticipant.ID,
            operation: Model.id("operation", "operation_k40"),
            repair: Model.id("repair", "repair_k40"),
            operationRevision: 0n,
            participantRevision: 1n,
            payload: { cancels: [{ subject: child, outcome: "interrupted", ref: payload.fences[0]!.ref }] },
          })
          expect(scope.current().cancelled).toBe(true)
          // The direct fixture stands in for Task's observer finalizer; cancellation itself never
          // fabricates A=0.
          yield* scope.finishContinuation()

          // ---- 1. RESULT IS CANCELLATION-OWNED, and did not merely hang ----
          const answered = yield* scope.result(speech(child, "fallback must not win")).pipe(Effect.timeoutOption(2000))
          expect(Option.isSome(answered)).toBe(true)
          if (Option.isSome(answered)) expect(answered.value).toMatchObject({ type: "cancelled" })

          // ---- 2. THE DUE WAKE CANNOT START A PROVIDER TURN ----
          expect(scope.needsWake()).toBe(false)
          expect(yield* scope.beginWake()).toBe(false)

          yield* Deferred.succeed(fence.held.release, undefined)
        }).pipe(Effect.provide(AttachmentCoordinator.layer)),
      )
    }),
  )

  it.live("participant cancel clears live and undelivered attachment state", () =>
    /**
     * A remains in `jobs`; B reaches U through `terminal`. Both are non-zero before the real
     * participant cancellation and zero after it. Active observer release remains the observers'
     * responsibility and is performed explicitly at the end of this direct fixture.
     */
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g8_clear")
      const node = Model.id("session", root)
      const child = SessionID.make("ses_g8_clear_child")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.Service
          const participant = AttachmentParticipant.make(coordinator)
          const scope = yield* coordinator.open(child)

          // ---- A: reserved and attached only, so it stays in `jobs` and counts as attached ----
          const liveA = yield* scope.reserve(SessionID.make("ses_g8_clear_a"))
          expect((yield* scope.claimObserver(liveA)).type).toBe("owner")

          // ---- B: additionally terminalized, so it moves into `undelivered` ----
          const liveB = yield* scope.reserve(SessionID.make("ses_g8_clear_b"))
          expect((yield* scope.claimObserver(liveB)).type).toBe("owner")
          const itemB = yield* scope.terminal(liveB)
          expect(itemB).toBeTruthy()

          // ---- PRECONTROL: both retained buckets genuinely occupied before the fence ----
          const before = scope.current()
          expect(before.attached).toBe(1)
          expect(before.undelivered).toBe(1)
          expect(before.cancelled).toBe(false)

          // ---- core captures, then represented physical signalling, then participant cancel ----
          const closure = yield* SessionClosure.Service
          yield* holdLease(closure, root, "clear")
          const fence = yield* raiseFence(closure, runs, root, node)
          const payload = fencePayload([child])
          yield* participant.claim({
            kind: "claim",
            participant: AttachmentParticipant.ID,
            operation: Model.id("operation", "operation_clear"),
            repair: Model.id("repair", "repair_clear"),
            operationRevision: 0n,
            participantRevision: 0n,
            payload,
          })
          expect(scope.current().cancelled).toBe(false)
          yield* participant.cancel({
            kind: "cancel",
            participant: AttachmentParticipant.ID,
            operation: Model.id("operation", "operation_clear"),
            repair: Model.id("repair", "repair_clear"),
            operationRevision: 0n,
            participantRevision: 1n,
            payload: { cancels: [{ subject: child, outcome: "interrupted", ref: payload.fences[0]!.ref }] },
          })

          // ---- CLEARED: live jobs and undelivered outcomes are gone, and the scope says so ----
          const after = scope.current()
          expect(after.attached).toBe(0)
          expect(after.undelivered).toBe(0)
          expect(after.cancelled).toBe(true)
          yield* scope.finishContinuation()
          yield* scope.finishContinuation()

          yield* Deferred.succeed(fence.held.release, undefined)
        }).pipe(Effect.provide(AttachmentCoordinator.layer)),
      )
    }),
  )

  it.live("naming a child cancels only that child's scope, while naming the parent suppresses its wake", () =>
    /**
     * Targeted child cancellation with a surviving parent permits one normal delivery and wake;
     * an ancestor closure that includes the parent suppresses that wake instead.
     *
     * The differential runs under one fence with two independent parent/child pairs, so the only
     * variable between the arms is whether the parent is named in the claim. Running the arms
     * sequentially against a single pair would not work: cancellation is monotonic, so once a parent
     * is cancelled it stays cancelled and the surviving arm could never be observed afterwards. Two
     * pairs under one claim isolates the variable exactly.
     *
     * What makes targeting work is the claim-time exact binding. Naming a child captures that
     * child's current Scope under core's opaque fence ref; later cancellation invokes the captured
     * Scope capability without re-locating the reusable SessionID. A parent's Scope is untouched
     * unless the parent is itself named. That is why "targeted" is a real property rather than a
     * description of intent, and why a replacement scope under the same id cannot redirect
     * cancellation.
     *
     * Arm 1 asserts a survival, and that is deliberate. Everything else on this cancellation path
     * asserts a suppression, and a suppression here is always reachable by a second route - atomic
     * cancellation both clears the substrate a predicate reads and derives state that blocks it
     * again - so weakening one guard need not change the result. A survival has no such second
     * route: nothing else in the system produces it. Asserting what survives is therefore how to get
     * independent falsification on a path where asserting what is suppressed cannot, which is the
     * transferable part of this test. Exact targeting's own independent check is the replacement
     * scope case: swap the SessionID's registered Scope between claim and cancel, and only the
     * captured generation is cancelled.
     *
     * The wake precontrol is load-bearing for both arms. `needsWake()` is an eight-term conjunction,
     * so a parent in any ordinary state answers false for reasons unrelated to a fence. Both parents
     * are driven to the exact state where a wake is genuinely due (`everAttached`, no live jobs, no
     * undelivered outcome, no clean candidate) and asserted true before the claim, so arm 1's true
     * means "still due" and arm 2's false means "suppressed" rather than "never was due".
     *
     * The edge-record half is not proved here, for a structural reason rather than by choice. Core's
     * record projection lives in the driver fixture, which creates and provides its own Instance
     * internally, while a `Ports.Participant` must be constructed before that fixture runs and its
     * methods carry no requirement channel. Since the attachment registry is per-Instance, a
     * coordinator built outside would `locate` nothing. That is a test-composition obstacle, not a
     * gap in the capability; core's edge-record behaviour for a closed branch is covered separately.
     */
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g8_k28")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.Service
          const participant = AttachmentParticipant.make(coordinator)

          // Drives a scope to the exact state where a wake is DUE.
          const wakeReady = (owner: SessionID, tag: string) =>
            Effect.gen(function* () {
              const scope = yield* coordinator.open(owner)
              const reservation = yield* scope.reserve(SessionID.make(`ses_g8_k28_job_${tag}`))
              expect((yield* scope.claimObserver(reservation)).type).toBe("owner")
              const item = yield* scope.terminal(reservation)
              expect(item).toBeTruthy()
              yield* scope.settleTerminal(item!)
              return { scope }
            })

          const parentA = SessionID.make("ses_g8_k28_parent_a")
          const childA = SessionID.make("ses_g8_k28_child_a")
          const parentB = SessionID.make("ses_g8_k28_parent_b")
          const childB = SessionID.make("ses_g8_k28_child_b")

          const survivor = yield* wakeReady(parentA, "a")
          const suppressed = yield* wakeReady(parentB, "b")
          // The children own scopes of their own; these are what the claim will name.
          const scopeChildA = yield* coordinator.open(childA)
          expect(
            (yield* scopeChildA.claimObserver(yield* scopeChildA.reserve(SessionID.make("ses_g8_k28_ca")))).type,
          ).toBe("owner")
          const scopeChildB = yield* coordinator.open(childB)
          expect(
            (yield* scopeChildB.claimObserver(yield* scopeChildB.reserve(SessionID.make("ses_g8_k28_cb")))).type,
          ).toBe("owner")

          // ---- PRECONTROL: both parents genuinely due a wake, both children live ----
          expect(survivor.scope.needsWake()).toBe(true)
          expect(suppressed.scope.needsWake()).toBe(true)
          expect(scopeChildA.current().cancelled).toBe(false)
          expect(scopeChildB.current().cancelled).toBe(false)

          // ---- core fences, then ONE claim naming child A alone, and child B WITH its parent ----
          const closure = yield* SessionClosure.Service
          yield* holdLease(closure, root, "k28")
          const fence = yield* raiseFence(closure, runs, root, node)
          const payload = fencePayload([childA, childB, parentB])
          yield* participant.claim({
            kind: "claim",
            participant: AttachmentParticipant.ID,
            operation: Model.id("operation", "operation_k28"),
            repair: Model.id("repair", "repair_k28"),
            operationRevision: 0n,
            participantRevision: 0n,
            payload,
          })
          expect(scopeChildA.current().cancelled).toBe(false)
          expect(scopeChildB.current().cancelled).toBe(false)
          yield* participant.cancel({
            kind: "cancel",
            participant: AttachmentParticipant.ID,
            operation: Model.id("operation", "operation_k28"),
            repair: Model.id("repair", "repair_k28"),
            operationRevision: 0n,
            participantRevision: 1n,
            payload: {
              cancels: [
                { subject: childA, outcome: "interrupted", ref: payload.fences[0]!.ref },
                { subject: childB, outcome: "interrupted", ref: payload.fences[1]!.ref },
                { subject: parentB, outcome: "interrupted", ref: payload.fences[2]!.ref },
              ],
            },
          })

          // ---- BOTH CHILDREN ARE CANCELLED: the receipt reached every subject core named ----
          expect(scopeChildA.current().cancelled).toBe(true)
          expect(scopeChildB.current().cancelled).toBe(true)

          // ---- ARM 1, TARGETED: parent A was never named, so it survives and its wake is intact ----
          expect(survivor.scope.current().cancelled).toBe(false)
          expect(survivor.scope.needsWake()).toBe(true)

          // ---- ARM 2, ANCESTOR CLOSURE: parent B was named, so its due wake is suppressed ----
          expect(suppressed.scope.current().cancelled).toBe(true)
          expect(suppressed.scope.needsWake()).toBe(false)
          expect(yield* suppressed.scope.beginWake()).toBe(false)

          yield* Deferred.succeed(fence.held.release, undefined)
        }).pipe(Effect.provide(AttachmentCoordinator.layer)),
      )
    }),
  )

  it.live("a fence revokes an issued permit and the registry's later consume wins nothing", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g4_k118a")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const held = yield* holdLease(closure, root, "k118a")
          const ids = coordinates("k118a")

          const outcome = yield* closure.jobStart({ ...ids, lease: held.lease, epoch: held.epoch })
          expect(outcome.type).toBe("arm_allowed")
          if (outcome.type !== "arm_allowed") return

          // Positive precondition: the permit really is claimable BEFORE the fence, so the `false`
          // below is the fence's doing and not a permit that was never viable.
          const before = yield* closure.view
          expect(before.armPermits.find((item) => item.id === outcome.permit)?.state).toBe("issued")

          const fence = yield* raiseFence(closure, runs, root, node)

          // revocation won the CAS, so the registry's consume produces zero run effects.
          expect(yield* closure.jobPermit(outcome.permit, "consume")).toBe(false)

          const after = yield* closure.view
          expect(after.armPermits.find((item) => item.id === outcome.permit)).toBeUndefined()
          expect(jobOf(after, "k118a")).toBeUndefined()

          yield* Deferred.succeed(fence.held.release, undefined)
        }),
      )
    }),
  )

  it.live("consume wins first, and a later fence adopts rather than rewriting it", () =>
    Effect.gen(function* () {
      const { runs, ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g4_k118b")
      const node = Model.id("session", root)

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const held = yield* holdLease(closure, root, "k118b")
          const ids = coordinates("k118b")

          const outcome = yield* closure.jobStart({ ...ids, lease: held.lease, epoch: held.epoch })
          expect(outcome.type).toBe("arm_allowed")
          if (outcome.type !== "arm_allowed") return

          expect(yield* closure.jobPermit(outcome.permit, "consume")).toBe(true)

          const armed = yield* closure.view
          expect(armed.armPermits.find((item) => item.id === outcome.permit)?.state).toBe("consumed")
          expect(jobOf(armed, "k118b")?.state).toBe("armed")

          // ROW 15, the promotion-time lease gap, closed and observable. On consume the lease stops
          // belonging to the caller's scope and becomes owned by the exact job invocation, so it no
          // longer retires when the admitting caller's scope exits - which is precisely the window
          // where queued extension work used to be covered by nothing.
          const owner = armed.leases.find((item) => item.id === held.lease)?.owner
          expect(owner).toEqual({ type: "job", job: ids.job, lifetime: ids.lifetime, sequence: 0n })
          expect(armed.leases.find((item) => item.id === held.lease)?.state).toBe("bound")

          const fence = yield* raiseFence(closure, runs, root, node)

          // A fence never rewrites `consumed` to `revoked`. The invocation is a pre-fence admission
          // the operation adopts and cancels through the whole token instead.
          const fenced = yield* closure.view
          expect(fenced.armPermits.find((item) => item.id === outcome.permit)?.state).toBe("consumed")

          yield* Deferred.succeed(fence.held.release, undefined)
        }),
      )
    }),
  )

  // The claim handed OUT, not the one called through jobPermit.
  //
  // Every other test here consumes with `closure.jobPermit(permit, "consume")`. The registry does
  // not: it runs `ArmPermit.claim`, the effect this outcome carries (background-job.ts consumes on
  // both the start and extend paths, before it modifies its own state). Those were two different
  // code paths, and only one of them was covered - so a `claim` that flipped the cell WITHOUT
  // applying `job.permit` passed every test in this file while leaving the model believing the
  // permit was still `issued`, the token short of `armed`, and the lease owner never stamped.
  // This is the defence for that path, asserted through the model rather than the cell.
  it.live("the claim the registry is handed also tells the model, not just the cell", () =>
    Effect.gen(function* () {
      const { ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g4_claimpath")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const held = yield* holdLease(closure, root, "claimpath")
          const ids = coordinates("claimpath")

          const outcome = yield* closure.jobStart({ ...ids, lease: held.lease, epoch: held.epoch })
          expect(outcome.type).toBe("arm_allowed")
          if (outcome.type !== "arm_allowed") return

          // Precondition: before the claim runs, the model has an issued permit and an unarmed token.
          const before = yield* closure.view
          expect(before.armPermits.find((item) => item.id === outcome.permit)?.state).toBe("issued")
          expect(jobOf(before, "claimpath")?.state).toBe("binding")

          expect(yield* outcome.claim).toBe(true)

          const after = yield* closure.view
          expect(after.armPermits.find((item) => item.id === outcome.permit)?.state).toBe("consumed")
          expect(jobOf(after, "claimpath")?.state).toBe("armed")
          expect(after.leases.find((item) => item.id === held.lease)?.owner).toEqual({
            type: "job",
            job: ids.job,
            lifetime: ids.lifetime,
            sequence: 0n,
          })

          // Exactly-once: the CAS is the admission linearization, so a second run wins nothing and
          // cannot re-apply the event.
          expect(yield* outcome.claim).toBe(false)
          const twice = yield* closure.view
          expect(twice.armPermits.filter((item) => item.id === outcome.permit)).toHaveLength(1)
          expect(twice.armPermits.find((item) => item.id === outcome.permit)?.state).toBe("consumed")
        }),
      )
    }),
  )

  // The wrong-epoch rejection, and where it is actually enforced.
  //
  // Not in `decideBind`: disabling its epoch re-check leaves this test passing. The reason is
  // layering. `jobStart` reduces a `job.start` event, and the model's `validLease` rejects a stale
  // epoch there - before `startJob` registers a JobView and before any `job.bind` command is
  // emitted. `decideBind` is therefore never reached on this path, so the rejection and the absent
  // permit are the model's guarantee rather than the coordinator's. The assertions below are worth
  // holding; they just do not establish anything about the coordinator.
  //
  // `decideBind`'s epoch check is not dead code, and is deliberately retained: `apply` releases the
  // authority lock between reducing the event and running `interpretAll`, so a concurrent release
  // can advance the session epoch in that window and the command's epoch goes stale between
  // validation and bind. That interleaving is real in production. It has no deterministic injection
  // seam at this gate - there is no hook between reduce and interpret - so it is carried as
  // defence-in-depth rather than claimed as a falsified defence. A gate that adds such a seam
  // should discharge it properly.
  it.live("a wrong epoch is rejected by the model before a bind is ever emitted", () =>
    Effect.gen(function* () {
      const { ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g4_k120epoch")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const held = yield* holdLease(closure, root, "k120epoch")
          const ids = coordinates("k120epoch")

          // Positive control first: the SAME coordinates at the correct epoch do arm. Without this
          // the rejection below would be consistent with the bind never being viable at all.
          const control = yield* closure.jobStart({
            ...coordinates("k120control"),
            lease: held.lease,
            epoch: held.epoch,
          })
          expect(control.type).toBe("arm_allowed")

          const outcome = yield* closure.jobStart({ ...ids, lease: held.lease, epoch: held.epoch + 7n })

          expect(outcome.type).toBe("rejected")
          const view = yield* closure.view
          expect(view.armPermits.filter((item) => item.lifetime === ids.lifetime)).toHaveLength(0)
          // The load-bearing half, and what locates the guard: `startJob` returns before it
          // registers a JobView, so the stale-epoch start leaves no job at all. A rejection that
          // happened at bind time would have registered one first and then terminalized it.
          expect(view.jobs.filter((item) => item.lifetime === ids.lifetime)).toHaveLength(0)
          // The control's lifetime DID register, so the absence above is this start's rejection
          // rather than the view simply not carrying jobs.
          expect(view.jobs.filter((item) => item.lifetime === coordinates("k120control").lifetime)).toHaveLength(1)
        }),
      )
    }),
  )

  it.live("an unknown permit handle consumes nothing", () =>
    Effect.gen(function* () {
      const { ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g4_k120permit")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const held = yield* holdLease(closure, root, "k120permit")
          const ids = coordinates("k120permit")

          const outcome = yield* closure.jobStart({ ...ids, lease: held.lease, epoch: held.epoch })
          expect(outcome.type).toBe("arm_allowed")
          if (outcome.type !== "arm_allowed") return

          // A foreign handle wins nothing...
          expect(yield* closure.jobPermit(Model.id("arm", "arm_foreign"), "consume")).toBe(false)
          // ...and leaves the real permit untouched and still claimable, which is the half that
          // proves the `false` came from handle exactness rather than from a dead permit.
          const view = yield* closure.view
          expect(view.armPermits.find((item) => item.id === outcome.permit)?.state).toBe("issued")
          expect(yield* closure.jobPermit(outcome.permit, "consume")).toBe(true)
        }),
      )
    }),
  )

  it.live("binder failure terminalizes the exact token and revokes its permit", () =>
    Effect.gen(function* () {
      const { ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g4_i50")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const held = yield* holdLease(closure, root, "i50")
          const ids = coordinates("i50")

          const outcome = yield* closure.jobStart({ ...ids, lease: held.lease, epoch: held.epoch })
          expect(outcome.type).toBe("arm_allowed")
          if (outcome.type !== "arm_allowed") return

          yield* closure.jobBinderFailed(ids.job, ids.lifetime)

          const view = yield* closure.view
          expect(jobOf(view, "i50")).toBeUndefined()
          // Binder failure revokes and reaps, so a consume arriving after it gave up produces zero run effects.
          expect(view.armPermits.find((item) => item.id === outcome.permit)).toBeUndefined()
          expect(yield* outcome.claim).toBe(false)
          expect(yield* closure.jobPermit(outcome.permit, "consume")).toBe(false)
        }),
      )
    }),
  )

  // The end-to-end proof, and the reason the layer graph is wired this way.
  //
  // Every other test in this file calls `closure.jobStart` directly, and every test that starts a
  // background job elsewhere runs against a permissive or fake binder. Neither proves the thing
  // that actually matters in production: that a caller's real admission travels caller -> core
  // registry -> binder -> coordinator and is decided there. Production path and test path being
  // different paths is the shape that hides defects until they reach a real caller.
  //
  // The assertion is the lease-ownership transfer rather than the job's status, deliberately. A
  // permissive binder would also let this job run to completion, so asserting `completed` would
  // discriminate nothing. Only a real coordinator consuming a real arm permit
  // re-owns the caller's lease to the exact job invocation; if the binder never reached one, the
  // lease is still `reserved` with no owner at all.
  it.live("end to end: a real caller lease reaches the coordinator through the registry and arms", () =>
    Effect.gen(function* () {
      const { ports } = yield* inflightPorts()
      const root = SessionID.make("ses_g4_e2e")

      yield* withRunState(realClosure(ports), () =>
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const jobs = yield* BackgroundJob.Service
          const held = yield* holdLease(closure, root, "e2e")

          // Positive precondition, and it makes the assertion below sharper than "an owner appeared".
          // The lease is already owned - by its pre-bind scope, the interruptible admission owner
          // that exists from the moment the lease does. What arming performs is the exactly-once
          // replacement of that owner, so the discriminator is the owner changing kind from `scope`
          // to `job`, which a binder that never reached the coordinator cannot produce.
          const before = (yield* closure.view).leases.find((item) => item.id === held.lease)
          expect(before?.state).toBe("reserved")
          expect(before?.owner?.type).toBe("scope")

          const release = yield* Deferred.make<void>()
          const info = yield* jobs.start({
            id: "job_e2e",
            type: "test",
            run: Deferred.await(release).pipe(Effect.as(noAnswer)),
            admission: { lease: held.lease, epoch: held.epoch },
          })
          expect(info.status).toBe("running")

          const view = yield* closure.view
          const after = view.leases.find((item) => item.id === held.lease)
          expect(after?.state).toBe("bound")
          // Narrowed field assertions rather than a structural matcher: `toMatchObject` did not
          // partial-match here, and a matcher whose semantics are assumed rather than checked is
          // exactly how an assertion ends up proving nothing.
          const owner = after?.owner
          expect(owner?.type).toBe("job")
          if (owner?.type !== "job") return
          expect(owner.sequence).toBe(0n)
          // The owner names a job and lifetime the COORDINATOR actually registered. Asserted by
          // lookup rather than by re-deriving the ID string, because that format is incidental to
          // what this proves - and hardcoding it was wrong twice before it was right.
          expect(view.jobs.some((item) => item.id === owner.job && item.lifetime === owner.lifetime)).toBe(true)

          yield* Deferred.succeed(release, undefined)
          expect((yield* jobs.wait({ id: "job_e2e" })).info?.status).toBe("completed")
          const terminal = yield* closure.view
          expect(terminal.leases.find((item) => item.id === held.lease)).toBeUndefined()
          expect(terminal.jobs.find((item) => item.id === owner.job)).toBeUndefined()
        }),
      )
    }),
  )
})
