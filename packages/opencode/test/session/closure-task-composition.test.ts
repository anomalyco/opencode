import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { BackgroundJob as CoreBackgroundJob } from "@opencode-ai/core/background-job"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Exit, Fiber, Layer, Queue, Ref, Scope } from "effect"
import { BackgroundJob } from "@/background/job"
import { BackgroundJobBinder } from "@/background/binder"
import { AttachmentCoordinator } from "@/session/attachment/coordinator"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionToolPartPermit } from "@/session/toolpart-permit"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { SessionRunState } from "@/session/run-state"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { itBounded as it } from "../lib/effect"

/**
 * CP-023 §17.2 — the Task-claim / JobLifetime composition suite and its negative oracle.
 *
 * §18 Gate 8 step 7: "run the Task-claim / JobLifetime composition suite in §17.2, including its
 * negative oracle, against the real participant." §17.2 conjunctively executes CP-021 TS-02 and
 * TS-11 with CP-023 K115, K116 and K121.
 *
 * WHY THIS IS A HARNESS AND NOT `task.ts` DRIVEN END TO END. Every §17.2 item is a property of the
 * ORDERING between CP-021's Task-local claim and CP-023's first core entry. `task.ts` reaches that
 * ordering only through a provider/model turn, an agent resolution and a Session prompt, none of
 * which participate in the property. §17.2 names its own subject a "harness configuration", so a
 * harness is what it asks for. What makes the harness honest is that everything it composes is
 * REAL — `AttachmentCoordinator.claim`/`awaitClaim`/`settleClaim`, the real `BackgroundJob`
 * registry, the real `BackgroundJobBinder`, and the real `SessionClosure` behind it — and that
 * `taskPrompt` below reproduces `task.ts`'s ordering statement for statement, with the divergences
 * named at each site. The one thing a harness cannot pin by construction is that it still MIRRORS
 * production, so the last row in this file pins that against `task.ts` source by symbol.
 *
 * THE MECHANISM, measured from source rather than assumed.
 *
 *   `AttachmentCoordinator.claim` (`coordinator.ts`, `const claim`) is an `Effect.sync`
 *   check-and-set on the per-Instance registry. There is no suspension point between its read and
 *   its write, so THAT is the linearization point: the first caller receives
 *   `{owner: true, token, ready}` and every later caller receives `{owner: false, ready}` carrying
 *   the owner's Deferred. `awaitClaim` returns `true` immediately to the owner and blocks a loser
 *   on that Deferred. `settleClaim` is owner-only, uninterruptible, and deletes the registry entry
 *   only on token IDENTITY — the same ABA-safe device `Lifetime.token` uses, so a late settle from
 *   a superseded claim cannot evict a live one.
 *
 *   `task.ts` orders it: claim -> `awaitClaim` (a loser exits on `false`) -> core entry ->
 *   `settleClaim(true)` on success, with `Effect.ensuring(settleClaim(false))` as the failure path.
 *
 * R-38 IS WHAT THIS SUITE EXISTS TO DETECT. CP-021 owns which Task PROMPT owns execution and
 * terminal notification; CP-023 owns which BackgroundJob LIFETIME may arm, fork or cancel. They compose
 * only if CP-021's Task-local claim linearizes first. Two stop conditions require CP-021 revision
 * rather than a workaround: anything that moves Task-prompt ownership into `BackgroundJob.start()`,
 * and anything that makes two Task prompts share one caller result.
 */

// ---------------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------------

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

const realClosure = (ports: Ports.RuntimePorts) =>
  SessionClosure.layer.pipe(
    Layer.provide(SessionToolPartPermit.layer),
    Layer.provide(Ports.makeLayer(() => Effect.succeed(ports))),
  )

const inertPorts = () =>
  Effect.gen(function* () {
    const runs = yield* Queue.unbounded<HeldRun>()
    const ports: Ports.RuntimePorts = { driver: heldDriver(runs), participants: [], hooks: {} }
    return { runs, ports }
  })

/**
 * Real closure, real registry, real coordinator, one Instance.
 *
 * Copied in shape from `closure-job-bind.test.ts`'s `withRunState`, including its two load-bearing
 * details: `BackgroundJob` is PROVIDED the closure rather than merged beside it (`mergeAll` does
 * not satisfy one member's requirements from another), and the same layer object is used both
 * places so the binder and the admission seam talk to ONE coordinator.
 */
const withComposition = <A, E, R>(
  body: (
    directory: string,
  ) => Effect.Effect<A, E, R | SessionRunState.Service | SessionClosure.Service | AttachmentCoordinator.Service>,
) =>
  Effect.gen(function* () {
    const { ports } = yield* inertPorts()
    const closure = realClosure(ports)
    const directory = yield* tmpdirScoped()
    const graph = LayerNode.compile(
      LayerNode.group([
        SessionRunState.node,
        BackgroundJob.node,
        SessionClosure.node,
        SessionStatus.node,
        AttachmentCoordinator.node,
      ]),
      [
        [SessionClosure.node, closure],
        [SessionStatus.node, statusStub],
      ],
    )
    return yield* body(directory).pipe(
      Effect.provide(graph),
      provideInstanceEffect(directory),
    )
  }).pipe(Effect.provide(services))

/** A real caller lease, exactly as `task.ts`'s `ops.admitScoped` supplies one per Task prompt. */
const holdLease = (closure: SessionClosure.Interface, session: SessionID, tag: string) =>
  Effect.gen(function* () {
    const signal = yield* Deferred.make<void>()
    const decision = yield* closure.acquire({
      session,
      origin: "internal",
      retry: "initial",
      source: `test.g8.composition.${tag}`,
      owner: { id: Model.id("scope", `g8:composition:${tag}`), signal },
    })
    expect(decision.type).toBe("admitted")
    if (decision.type !== "admitted") return yield* Effect.die("expected an admission")
    return { lease: decision.lease, epoch: decision.epoch } satisfies BackgroundJob.Admission
  })

/** Spins until `check` holds, so a row never asserts on a not-yet-scheduled fiber. */
const until = (check: Effect.Effect<boolean>): Effect.Effect<void> =>
  check.pipe(Effect.flatMap((done) => (done ? Effect.void : Effect.sleep(1).pipe(Effect.andThen(until(check))))))

// ---------------------------------------------------------------------------------------------
// The Task prompt, reproduced
// ---------------------------------------------------------------------------------------------

type Outcome =
  | { readonly kind: "started"; readonly lifetime?: BackgroundJob.Lifetime; readonly jobID: string }
  | { readonly kind: "extended" }
  | { readonly kind: "updated" }
  | { readonly kind: "collision" }

type Journal = {
  /** A prompt's tag, pushed immediately BEFORE its first core entry. */
  readonly entered: string[]
  /** A prompt's tag, pushed from inside its own run effect. */
  readonly ran: string[]
  /** A prompt's tag, pushed when CP-021's `attach` awarded it observer ownership. */
  readonly attached: string[]
}

const journal = (): Journal => ({ entered: [], ran: [], attached: [] })

type PromptInput = {
  readonly tag: string
  readonly jobs: BackgroundJob.Interface
  readonly attachments: AttachmentCoordinator.Interface
  readonly session: SessionID
  readonly admission: BackgroundJob.Admission
  readonly run: Effect.Effect<CoreBackgroundJob.SequenceOutcome, unknown>
  readonly journal: Journal
  readonly parentScope?: AttachmentCoordinator.Scope
  /**
   * Parks this prompt AFTER `extend` has answered `false` and BEFORE `startExact`. Inert unless a
   * row supplies it. §17.1 forbids establishing order by sleep or timing luck, and the window this
   * suite is about is exactly the one between "no job exists yet" and "a job is registered" — so it
   * is parked deterministically rather than raced for.
   */
  readonly beforeStart?: Effect.Effect<void>
}

/**
 * `task.ts`'s admission ordering, statement for statement.
 *
 * MAPPING, by symbol rather than by line, since line citations rot and nothing tests them:
 * `parentScope.reserve` -> `const reservation`; `attachments.claim` -> `const claim`; the
 * `!claim.owner` branch -> `awaitClaim`/`promote`/`extend`/`attachExtension`/"Async task updated";
 * the owner branch -> `promote`/`extend`/the `!reservation.fresh` ABA guard/`startExact`/
 * `settleClaim(claim, true)`; and the whole owner branch under `Effect.ensuring(settleClaim(claim,
 * false))`.
 *
 * THREE DELIBERATE DIVERGENCES, each because the omitted thing needs a provider turn and none of
 * them participates in the ordering:
 *
 *   1. `runTask`/`ops.prompt` is replaced by the row's own `run` effect. What the composition needs
 *      from it is only that each prompt's run is DISTINGUISHABLE from the other's, which is exactly
 *      what makes "the loser received the owner's execution" observable.
 *   2. The observer continuation is replaced by recording the tag. Production gates it on
 *      `parentScope.claimObserver(reservation)` returning `owner`, so that result IS the
 *      delivery-ownership award; what follows it is injection, which needs a provider.
 *   3. `TaskTool.attach` and `TaskTool.attachExtension` collapse into one `awardObserver`. They
 *      differ only in which exact observation source they hand the one notifier, and both call the
 *      same `parentScope.claimObserver(reservation)`.
 */
const taskPrompt = (input: PromptInput) =>
  Effect.gen(function* () {
    const jobs = input.jobs
    const attachments = input.attachments
    const session = input.session
    const parentScope = input.parentScope

    const reservation = parentScope ? yield* parentScope.reserve(session) : undefined

    const awardObserver = Effect.gen(function* () {
      if (!parentScope || !reservation) return
      if ((yield* parentScope.claimObserver(reservation)).type === "owner") input.journal.attached.push(input.tag)
    })

    const enterCore = Effect.sync(() => {
      if (!input.journal.entered.includes(input.tag)) input.journal.entered.push(input.tag)
    })

    const collision = Effect.succeed({ kind: "collision" } as const)

    const claim = yield* attachments.claim(session)

    if (!claim.owner) {
      if (!(yield* attachments.awaitClaim(claim))) {
        if (parentScope && reservation) yield* parentScope.reject(reservation)
        return yield* collision
      }
      yield* enterCore
      if (parentScope) yield* jobs.promote(session)
      if (!(yield* jobs.extend({ id: session, run: input.run, admission: input.admission }))) {
        if (parentScope && reservation) yield* parentScope.reject(reservation)
        return yield* collision
      }
      yield* awardObserver
      return { kind: "updated" } as const
    }

    return yield* Effect.gen(function* () {
      yield* enterCore
      if (parentScope) yield* jobs.promote(session)
      const extended = yield* jobs.extend({ id: session, run: input.run, admission: input.admission }).pipe(Effect.exit)
      if (Exit.isFailure(extended)) {
        if (parentScope && reservation) yield* parentScope.reject(reservation)
        return yield* Effect.failCause(extended.cause)
      }
      if (extended.value) {
        yield* awardObserver
        yield* attachments.settleClaim(claim, true)
        return { kind: "extended" } as const
      }
      if (parentScope && reservation && !reservation.fresh) {
        yield* parentScope.reject(reservation)
        return yield* collision
      }
      yield* input.beforeStart ?? Effect.void
      const started = yield* jobs
        .startExact({
          id: session,
          type: "task",
          run: input.run,
          onPromote: awardObserver,
          admission: input.admission,
        })
        .pipe(Effect.exit)
      if (Exit.isFailure(started)) {
        if (parentScope && reservation) yield* parentScope.reject(reservation)
        return yield* Effect.failCause(started.cause)
      }
      yield* awardObserver
      yield* attachments.settleClaim(claim, true)
      return { kind: "started", lifetime: started.value.lifetime, jobID: started.value.info.id } as const
    }).pipe(Effect.ensuring(attachments.settleClaim(claim, false)))
  })

/**
 * The SAME prompt with the Task-local claim removed, and nothing else changed.
 *
 * This is §17.2's required bypass seam. Before the Gate-8 lifecycle prerequisite made
 * `TaskPromptOps.attachments` a required hand-in, a harness could reach "two prompts with no common
 * claim" more or less by accident; it cannot now, which is a real improvement in the production
 * property and a real cost to the oracle. The hazard is not gone — it is unreachable BY
 * CONSTRUCTION, and this seam is what keeps it detectable if that construction ever lapses.
 */
const taskPromptWithoutClaim = (input: PromptInput) =>
  Effect.gen(function* () {
    const jobs = input.jobs
    const session = input.session
    const parentScope = input.parentScope
    const reservation = parentScope ? yield* parentScope.reserve(session) : undefined

    const awardObserver = Effect.gen(function* () {
      if (!parentScope || !reservation) return
      if ((yield* parentScope.claimObserver(reservation)).type === "owner") input.journal.attached.push(input.tag)
    })

    yield* Effect.sync(() => {
      if (!input.journal.entered.includes(input.tag)) input.journal.entered.push(input.tag)
    })
    if (parentScope) yield* jobs.promote(session)
    const extended = yield* jobs.extend({ id: session, run: input.run, admission: input.admission })
    if (extended) {
      yield* awardObserver
      return { kind: "extended" } as const
    }
    if (parentScope && reservation && !reservation.fresh) {
      yield* parentScope.reject(reservation)
      return { kind: "collision" } as const
    }
    yield* input.beforeStart ?? Effect.void
    const started = yield* jobs.startExact({
      id: session,
      type: "task",
      run: input.run,
      onPromote: awardObserver,
      admission: input.admission,
    })
    yield* awardObserver
    return { kind: "started", lifetime: started.lifetime, jobID: started.info.id } as const
  })

// ---------------------------------------------------------------------------------------------
// The oracle
// ---------------------------------------------------------------------------------------------

type Binding = { readonly tag: string; readonly sequence?: bigint; readonly lifetime?: string }

type Observed = {
  readonly outcomes: ReadonlyArray<{ readonly tag: string; readonly outcome: Outcome }>
  readonly bindings: readonly Binding[]
  readonly journal: Journal
}

/**
 * §17.2's composition properties, as ONE predicate used by both the positive row and the oracle.
 *
 * This shape is deliberate. An oracle written as a hand-mirrored copy of the positive row's
 * assertions proves only that two pieces of prose agree; this one proves that the EXACT check the
 * positive row passes is the check the bypass configuration fails. "The oracle can fire" is then a
 * mechanical property of the same function rather than a claim about it.
 *
 * Each entry names the §17.2 item it enforces.
 */
const compositionViolations = (observed: Observed): string[] => {
  const found: string[] = []
  const admitted = observed.outcomes.filter((entry) => entry.outcome.kind !== "collision")

  // Item 1: "The loser never receives the owner's execution or terminal result." Item 4: "no
  // outcome, retained prior output, wake, or caller return is duplicated across Task prompts."
  const carried = observed.outcomes.flatMap((entry) =>
    entry.outcome.kind === "started" && entry.outcome.lifetime
      ? [{ tag: entry.tag, token: entry.outcome.lifetime.token }]
      : [],
  )
  carried.forEach((left, index) =>
    carried.slice(index + 1).forEach((right) => {
      if (left.token === right.token) found.push(`shared-caller-result:${left.tag}+${right.tag}`)
    }),
  )

  // Item 1: an admitted prompt whose own run effect never ran took someone else's execution.
  admitted.forEach((entry) => {
    if (!observed.journal.ran.includes(entry.tag)) found.push(`admitted-prompt-executed-nothing:${entry.tag}`)
  })

  // Item 4: each admitted Task prompt binds its OWN invocation under its OWN caller lease.
  observed.bindings.forEach((binding) => {
    const entry = admitted.find((item) => item.tag === binding.tag)
    if (entry && binding.sequence === undefined) found.push(`admitted-prompt-bound-no-sequence:${binding.tag}`)
  })

  // Item 1: "Exactly one core arm attempt occurs." Sequence zero is the arm.
  const arms = observed.bindings.filter((binding) => binding.sequence === 0n)
  if (arms.length !== 1) found.push(`arm-attempts:${arms.length}`)

  // Item 4: distinct sequences, and one terminal observer/wake owner.
  const sequences = observed.bindings.flatMap((binding) => (binding.sequence === undefined ? [] : [binding.sequence]))
  if (new Set(sequences).size !== sequences.length) found.push(`duplicate-sequence:${sequences.join(",")}`)
  if (observed.journal.attached.length > 1)
    found.push(`duplicate-observer-ownership:${observed.journal.attached.join("+")}`)

  return found
}

/** Which invocation a Task prompt's own caller lease ended up owning, read from core's own view. */
const bindingOf = (view: Model.View, tag: string, admission: BackgroundJob.Admission): Binding => {
  const lease = view.leases.find((item) => item.id === Model.id("lease", admission.lease))
  if (!lease || lease.owner?.type !== "job") return { tag }
  return { tag, sequence: lease.owner.sequence, lifetime: lease.owner.lifetime }
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

describe("CP-023 §17.2 — Task-claim / JobLifetime composition", () => {
  /**
   * §17.2 item 1 — the cold-start barrier, TS-02 x K115.
   *
   * NO PARENT SCOPE, and that is the configuration this row must use rather than a simplification.
   * With a shared parent scope the ABA guard `!reservation.fresh` already refuses a second prompt
   * before it can reach `startExact`, so the claim would not be the barrier under test and the
   * oracle below could not fire at all — item 1 expressly permits "bounded collision" as an
   * outcome, which is what that guard produces. A Task invoked from a session carrying no
   * attachment scope — the ordinary root-agent case, `task.ts`'s `parentScope === undefined` with
   * the flag ON — is where CP-021's Task-local claim is the SOLE barrier. That is the property
   * R-38 turns on.
   */
  it.live("item 1: the loser stays outside core while the owner binds, then takes exactly one extension", () =>
    withComposition(() =>
      Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const jobs = yield* BackgroundJob.Service
        const attachments = yield* AttachmentCoordinator.Service
        const session = SessionID.make("ses_g8_comp_item1")
        const log = journal()

        const admissionA = yield* holdLease(closure, session, "item1a")
        const admissionB = yield* holdLease(closure, session, "item1b")
        const parkA = yield* Deferred.make<void>()
        const releaseRun = yield* Deferred.make<void>()
        const runOf = (tag: string) =>
          Effect.sync(() => log.ran.push(tag)).pipe(Effect.andThen(Deferred.await(releaseRun)), Effect.as({ position: `p_${tag}`, at: 0, detected: tag }))

        const promptA = yield* Effect.forkScoped(
          taskPrompt({
            tag: "A",
            jobs,
            attachments,
            session,
            admission: admissionA,
            run: runOf("A"),
            journal: log,
            beforeStart: Deferred.await(parkA),
          }),
        )
        // A is inside core, past `extend`, and has not yet registered anything.
        yield* until(Effect.sync(() => log.entered.includes("A")))
        expect(yield* jobs.get(session)).toBeUndefined()

        const promptB = yield* Effect.forkScoped(
          taskPrompt({
            tag: "B",
            jobs,
            attachments,
            session,
            admission: admissionB,
            run: runOf("B"),
            journal: log,
            beforeStart: Deferred.await(parkA),
          }),
        )
        // Room to misbehave before concluding it did not. THE item-1 assertion: the loser is held
        // OUTSIDE core by the claim, with the positive control that A is genuinely inside it.
        yield* Effect.sleep(25)
        expect(log.entered).toEqual(["A"])
        expect(bindingOf(yield* closure.view, "B", admissionB).sequence).toBeUndefined()

        yield* Deferred.succeed(parkA, undefined)
        const outcomeA = yield* Fiber.join(promptA)
        const outcomeB = yield* Fiber.join(promptB)

        // The loser entered core exactly once the owner had settled, and took ONE extension.
        expect(log.entered).toEqual(["A", "B"])
        expect(outcomeA.kind).toBe("started")
        expect(outcomeB).toEqual({ kind: "updated" })

        // Sample invocation ownership while the exact lifetime is still live. Terminal publication
        // now acknowledges and compacts the model-side job/binding history by design.
        const view = yield* closure.view
        yield* Deferred.succeed(releaseRun, undefined)
        if (outcomeA.kind !== "started" || !outcomeA.lifetime) return yield* Effect.die("owner armed no lifetime")
        yield* jobs.waitExact({ lifetime: outcomeA.lifetime })

        const observed: Observed = {
          outcomes: [
            { tag: "A", outcome: outcomeA },
            { tag: "B", outcome: outcomeB },
          ],
          bindings: [bindingOf(view, "A", admissionA), bindingOf(view, "B", admissionB)],
          journal: log,
        }

        // Each prompt ran its OWN work, under its OWN caller lease, on adjacent sequences of one
        // token. This is the state the oracle below must fail to produce.
        expect(observed.bindings[0]?.sequence).toBe(0n)
        expect(observed.bindings[1]?.sequence).toBe(1n)
        expect(observed.bindings[0]?.lifetime).toBe(observed.bindings[1]?.lifetime)
        expect(log.ran).toEqual(["A", "B"])
        expect(compositionViolations(observed)).toEqual([])
      }),
    ),
  )

  /**
   * §17.2 item 5 — THE NEGATIVE ORACLE.
   *
   * One bit apart from item 1: the same fixture, the same two prompts, the same park point, the
   * same predicate. Only the Task-local claim is gone.
   *
   * WHAT THE PARK POINT IS FOR, and it is the finding this row carries. Removing the claim does not
   * by itself produce a shared caller result — it produces a WINDOW, between "no job exists" and "a
   * job is registered", in which two prompts can both fall through `extend` and both reach
   * `startExact`. Outside that window a bypassed second prompt simply extends the first's job and
   * nothing is shared. So the oracle must construct the window, and §17.1 forbids racing for it,
   * which is why both prompts park deterministically at exactly the point production's claim would
   * have separated them. The claim's protection IS that window; naming it is what stops a later
   * reader from concluding the bypass is harmless because a casual version of it looked green.
   *
   * K115 STILL PASSES HERE, which is precisely §17.2 item 5's requirement. One bind, one permit,
   * one fork, one armed invocation — the registry behaves exactly as K115 proves it must. The
   * composition property fails anyway, because a single well-behaved core arm is not a substitute
   * for Task-prompt disposition.
   */
  it.live("item 5 (negative oracle): bypassing the claim shares one core arm and one caller result", () =>
    withComposition(() =>
      Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const jobs = yield* BackgroundJob.Service
        const attachments = yield* AttachmentCoordinator.Service
        const session = SessionID.make("ses_g8_comp_oracle")
        const log = journal()

        const admissionA = yield* holdLease(closure, session, "oraclea")
        const admissionB = yield* holdLease(closure, session, "oracleb")
        const parkA = yield* Deferred.make<void>()
        const parkB = yield* Deferred.make<void>()
        const releaseRun = yield* Deferred.make<void>()
        const runOf = (tag: string) =>
          Effect.sync(() => log.ran.push(tag)).pipe(Effect.andThen(Deferred.await(releaseRun)), Effect.as({ position: `p_${tag}`, at: 0, detected: tag }))

        const promptA = yield* Effect.forkScoped(
          taskPromptWithoutClaim({
            tag: "A",
            jobs,
            attachments,
            session,
            admission: admissionA,
            run: runOf("A"),
            journal: log,
            beforeStart: Deferred.await(parkA),
          }),
        )
        const promptB = yield* Effect.forkScoped(
          taskPromptWithoutClaim({
            tag: "B",
            jobs,
            attachments,
            session,
            admission: admissionB,
            run: runOf("B"),
            journal: log,
            beforeStart: Deferred.await(parkB),
          }),
        )

        // POSITIVE PRECONDITION, and without it this row would prove nothing. Both prompts are past
        // `extend` with NO job in existence, so both are genuinely about to start — the state the
        // claim makes unreachable. If either had extended the other's job the row would be
        // exercising the ordinary sequential path under a misleading name.
        yield* until(Effect.sync(() => log.entered.length === 2))
        expect(yield* jobs.get(session)).toBeUndefined()

        yield* Deferred.succeed(parkA, undefined)
        yield* until(jobs.get(session).pipe(Effect.map((info) => info !== undefined)))
        yield* Deferred.succeed(parkB, undefined)

        const outcomeA = yield* Fiber.join(promptA)
        const outcomeB = yield* Fiber.join(promptB)
        // The negative oracle needs the live binding ledger, not terminal history retained only for
        // diagnostics. Capture it before the physical run is released and terminal cleanup lands.
        const view = yield* closure.view
        yield* Deferred.succeed(releaseRun, undefined)
        if (outcomeA.kind !== "started" || !outcomeA.lifetime) return yield* Effect.die("owner armed no lifetime")
        yield* jobs.waitExact({ lifetime: outcomeA.lifetime })

        const observed: Observed = {
          outcomes: [
            { tag: "A", outcome: outcomeA },
            { tag: "B", outcome: outcomeB },
          ],
          bindings: [bindingOf(view, "A", admissionA), bindingOf(view, "B", admissionB)],
          journal: log,
        }

        // ---- K115's property, intact ----
        expect(observed.bindings[0]?.sequence).toBe(0n)
        expect(observed.bindings[1]?.sequence).toBeUndefined()
        // `accepted` IS the per-sequence discriminator, and asserting it against the API's actual
        // contract rather than an assumed one matters here. `observe` returns `undefined` only for
        // an UNKNOWN LIFETIME; for a known one it always answers, reporting sequence membership as
        // `accepted`. So "no second invocation was ever reserved" is `accepted:false` on sequence
        // one - an `undefined` assertion would have been testing lifetime existence while reading
        // as though it tested sequence existence. `state` likewise reads `terminal` rather than
        // `armed` because the lifetime has completed by here.
        //
        // The contrast with item 4 is the whole point: there BOTH sequences are accepted, because
        // two prompts bound two invocations. Here only sequence zero is - one bind, one permit, one
        // fork, exactly as K115 requires.
        const armed = yield* jobs.observe({ lifetime: outcomeA.lifetime, sequence: 0 })
        expect(armed?.accepted).toBe(true)
        expect(armed?.status).toBe("completed")
        expect((yield* jobs.observe({ lifetime: outcomeA.lifetime, sequence: 1 }))?.accepted).toBe(false)
        expect(log.ran).toEqual(["A"])

        // ---- and the composition property, failing on the same predicate item 1 passes ----
        const violations = compositionViolations(observed)
        expect(outcomeB.kind).toBe("started")
        if (outcomeB.kind !== "started") return yield* Effect.die("bypassed loser did not reach start")
        expect(outcomeB.lifetime?.token).toBe(outcomeA.lifetime.token)
        expect(violations).toContain("shared-caller-result:A+B")
        expect(violations).toContain("admitted-prompt-executed-nothing:B")
        expect(violations).toContain("admitted-prompt-bound-no-sequence:B")
      }),
    ),
  )

  /**
   * §17.2 item 2 — owner/binder failure.
   *
   * "If the owner fails before binding, the Task claim settles false. The loser receives bounded
   * collision. No second `start`, prompt substitution, duplicate delivery, or shared caller result
   * occurs."
   *
   * THE FAILURE IS AN INTERRUPT RATHER THAN AN INJECTED FAULT. `Effect.ensuring` runs on interrupt,
   * failure and defect alike, and `task.ts` places the claim's release on exactly that combinator,
   * so an interrupted owner exercises the real production path with nothing stubbed. A Task fiber
   * being interrupted mid-admission is also the likeliest way this happens in production.
   *
   * THE CLAIM BARRIER IS PROVEN NOT WEDGED, which is the assertion this row would be missing
   * otherwise. "The loser collided" is also what a permanently-stuck registry entry would produce
   * on a bounded test; a third prompt owning the claim afterwards distinguishes released from
   * jammed.
   */
  it.live("item 2: an owner interrupted before binding settles the claim false and the loser collides", () =>
    withComposition(() =>
      Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const jobs = yield* BackgroundJob.Service
        const attachments = yield* AttachmentCoordinator.Service
        const session = SessionID.make("ses_g8_comp_item2")
        const log = journal()

        const admissionA = yield* holdLease(closure, session, "item2a")
        const admissionB = yield* holdLease(closure, session, "item2b")
        const parkA = yield* Deferred.make<void>()

        const promptA = yield* Effect.forkScoped(
          taskPrompt({
            tag: "A",
            jobs,
            attachments,
            session,
            admission: admissionA,
            run: Effect.sync(() => log.ran.push("A")).pipe(Effect.as({ position: "p_A", at: 0, detected: "A" })),
            journal: log,
            beforeStart: Deferred.await(parkA),
          }),
        )
        yield* until(Effect.sync(() => log.entered.includes("A")))

        const promptB = yield* Effect.forkScoped(
          taskPrompt({
            tag: "B",
            jobs,
            attachments,
            session,
            admission: admissionB,
            run: Effect.sync(() => log.ran.push("B")).pipe(Effect.as({ position: "p_B", at: 0, detected: "B" })),
            journal: log,
          }),
        )
        yield* Effect.sleep(25)
        expect(log.entered).toEqual(["A"])

        yield* Fiber.interrupt(promptA)
        const outcomeB = yield* Fiber.join(promptB)

        expect(outcomeB).toEqual({ kind: "collision" })
        // No second start, no substitution, no delivery: nothing was ever registered or run.
        expect(yield* jobs.get(session)).toBeUndefined()
        expect(log.ran).toEqual([])
        expect(log.attached).toEqual([])
        expect(bindingOf(yield* closure.view, "B", admissionB).sequence).toBeUndefined()
        expect(
          compositionViolations({
            outcomes: [{ tag: "B", outcome: outcomeB }],
            bindings: [bindingOf(yield* closure.view, "B", admissionB)],
            journal: log,
          }),
        ).toEqual(["arm-attempts:0"])

        // Released, not jammed.
        const later = yield* attachments.claim(session)
        expect(later.owner).toBe(true)
        yield* attachments.settleClaim(later, false)
      }),
    ),
  )

  /**
   * §17.2 item 4 — ordered sequences and terminal ownership, TS-11 x K121, at TASK-PROMPT
   * granularity.
   *
   * The retired per-sequence delivery ledger is deliberately absent. This row now proves the
   * retained product invariant at Task-prompt granularity. Its
   * operative content is stated across TASK PROMPTS — "no outcome, retained prior output, wake, or
   * caller return is duplicated across Task prompts" — and CP-021 does distinguish Task prompts:
   * each carries its own caller lease, its own run effect, and its own reservation handle. So each
   * clause has a producer:
   *
   *   "distinct prompt/invocation ownership" — sequence zero is bound under prompt A's caller lease
   *   and sequence one under prompt B's, read from core's OWN lease view. Each sequence carries the
   *   run effect of the prompt that requested it, which is what makes the ownership have content
   *   rather than being an accounting label.
   *
   *   "one token-wide physical terminal winner" — both sequences observe one terminal status on one
   *   token.
   *
   *   "one terminal observer/wake owner" — CP-021's `claimObserver` returns `owner` to exactly one
   *   prompt, and that result gates the one notifier in production.
   *
   * Core's separate exact-handle tests retain sequence identity and same-ID ABA protection; this
   * composition row does not recreate removed delivery accounting.
   *
   * A PARENT SCOPE IS REQUIRED HERE, unlike items 1, 2 and 5, because observer/notification ownership
   * has no producer without one. Both prompts share one parent scope, which is the same-caller
   * case; the ABA guard is inert on this path because the loser never reaches it.
   */
  it.live("item 4: adjacent sequences carry distinct prompt ownership under one terminal winner", () =>
    withComposition(() =>
      Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const jobs = yield* BackgroundJob.Service
        const attachments = yield* AttachmentCoordinator.Service
        const parent = SessionID.make("ses_g8_comp_item4_parent")
        const session = SessionID.make("ses_g8_comp_item4")
        const log = journal()

        const parentScope = yield* attachments.open(parent)
        const admissionA = yield* holdLease(closure, session, "item4a")
        const admissionB = yield* holdLease(closure, session, "item4b")
        const parkA = yield* Deferred.make<void>()
        const releaseRun = yield* Deferred.make<void>()
        const runOf = (tag: string) =>
          Effect.sync(() => log.ran.push(tag)).pipe(Effect.andThen(Deferred.await(releaseRun)), Effect.as({ position: `p_${tag}`, at: 0, detected: tag }))

        const promptA = yield* Effect.forkScoped(
          taskPrompt({
            tag: "A",
            jobs,
            attachments,
            session,
            admission: admissionA,
            run: runOf("A"),
            journal: log,
            parentScope,
            beforeStart: Deferred.await(parkA),
          }),
        )
        yield* until(Effect.sync(() => log.entered.includes("A")))
        const promptB = yield* Effect.forkScoped(
          taskPrompt({
            tag: "B",
            jobs,
            attachments,
            session,
            admission: admissionB,
            run: runOf("B"),
            journal: log,
            parentScope,
          }),
        )
        yield* Effect.sleep(25)
        expect(log.entered).toEqual(["A"])
        yield* Deferred.succeed(parkA, undefined)

        const outcomeA = yield* Fiber.join(promptA)
        const outcomeB = yield* Fiber.join(promptB)
        expect(outcomeA.kind).toBe("started")
        expect(outcomeB).toEqual({ kind: "updated" })
        if (outcomeA.kind !== "started" || !outcomeA.lifetime) return yield* Effect.die("owner armed no lifetime")

        // Bindings are live authority evidence and intentionally disappear after exact terminal
        // acknowledgement, so preserve the proof sample before releasing either invocation.
        const view = yield* closure.view
        const bindings = [bindingOf(view, "A", admissionA), bindingOf(view, "B", admissionB)]
        yield* Deferred.succeed(releaseRun, undefined)
        const terminal = yield* jobs.waitExact({ lifetime: outcomeA.lifetime })

        // ---- distinct prompt/invocation ownership, on adjacent sequences of ONE token ----
        expect(bindings[0]?.sequence).toBe(0n)
        expect(bindings[1]?.sequence).toBe(1n)
        expect(bindings[0]?.lifetime).toBe(bindings[1]?.lifetime)
        // Each sequence carried the run effect of the prompt that requested it, in order.
        expect(log.ran).toEqual(["A", "B"])

        // ---- one token-wide physical terminal winner, observed by every sequence ----
        expect(terminal.info?.status).toBe("completed")
        const zero = yield* jobs.observe({ lifetime: outcomeA.lifetime, sequence: 0 })
        const one = yield* jobs.observe({ lifetime: outcomeA.lifetime, sequence: 1 })
        // ONE winner, reported identically to both sequences. `state` is the whole TOKEN's state,
        // which is what makes it the token-wide assertion: neither sequence has a terminal state of
        // its own to disagree with, and both were accepted invocations of it.
        expect(zero?.status).toBe("completed")
        expect(one?.status).toBe("completed")
        expect(zero?.state).toBe("terminal")
        expect(one?.state).toBe("terminal")
        expect(zero?.accepted).toBe(true)
        expect(one?.accepted).toBe(true)

        // ---- one terminal observer/wake owner, and the loser explicitly is not it ----
        expect(log.attached).toEqual(["A"])
        expect(parentScope.current().everAttached).toBe(true)

        expect(
          compositionViolations({
            outcomes: [
              { tag: "A", outcome: outcomeA },
              { tag: "B", outcome: outcomeB },
            ],
            bindings,
            journal: log,
          }),
        ).toEqual([])
      }),
    ),
  )

  /**
   * §17.2 item 3 — the unarmed lifetime, TS-02 x K116.
   *
   * "With an existing unarmed lifetime, the first Task-owned extension may wait on CP-023's
   * ArmPermit. A second competing Task prompt remains outside core behind the Task-local claim; it
   * does not become a second ArmPermit waiter and does not initiate another arm."
   *
   * WHY THIS ROW BUILDS ITS OWN REGISTRY. An unarmed lifetime is a state BETWEEN a bind request and
   * its decision, and the production binder has no park point there — `BackgroundJobBinder.bind`
   * asks `closure.jobStart` and answers, with no suspension the fixture can stand on. So the real
   * binder is WRAPPED rather than replaced: the authority answer is still the real closure's, and
   * only its delivery is delayed. That keeps the row's subject — the claim — honest, since nothing
   * about the arm decision itself is simulated.
   */
  it.live("item 3: a competing prompt behind the claim is not a second ArmPermit waiter", () =>
    Effect.gen(function* () {
      const { ports } = yield* inertPorts()
      const closureLayer = realClosure(ports)
      const directory = yield* tmpdirScoped()
      const gate = yield* Deferred.make<void>()
      const binds = yield* Ref.make<readonly number[]>([])
      // The SAME `closureLayer` object is handed to both members, which is what makes them one
      // coordinator: `Layer.provide` memoises on layer identity, so a second reference to an
      // equivalent-but-distinct layer would silently build a second closure and the binder would
      // then ask about leases the coordinator under test never issued.
      const jobsLayer = Layer.effect(
        CoreBackgroundJob.Service,
        Effect.gen(function* () {
          const closure = yield* SessionClosure.Service
          const real = yield* BackgroundJobBinder.make(closure)
          const wrapped: CoreBackgroundJob.Binder = {
            bind: (input) =>
              Ref.update(binds, (current) => [...current, input.sequence]).pipe(
                Effect.andThen(input.sequence === 0 ? Deferred.await(gate) : Effect.void),
                Effect.andThen(real.bind(input)),
              ),
            terminal: real.terminal,
          }
          return yield* CoreBackgroundJob.makeWith(wrapped)
        }),
      ).pipe(Layer.provide(closureLayer))
      return yield* Effect.gen(function* () {
        const closure = yield* SessionClosure.Service
        const jobs = yield* BackgroundJob.Service
        const attachments = yield* AttachmentCoordinator.Service
        const session = SessionID.make("ses_g8_comp_item3")
        const log = journal()

        const seed = yield* holdLease(closure, session, "item3seed")
        const admissionA = yield* holdLease(closure, session, "item3a")
        const admissionB = yield* holdLease(closure, session, "item3b")
        const releaseRun = yield* Deferred.make<void>()
        const runOf = (tag: string) =>
          Effect.sync(() => log.ran.push(tag)).pipe(Effect.andThen(Deferred.await(releaseRun)), Effect.as({ position: `p_${tag}`, at: 0, detected: tag }))

        // An EXISTING unarmed lifetime, parked at the real binder's sequence-zero decision.
        const seeding = yield* Effect.forkScoped(
          jobs.startExact({ id: session, type: "task", run: runOf("seed"), admission: seed }),
        )
        yield* until(Ref.get(binds).pipe(Effect.map((current) => current.length === 1)))
        expect((yield* jobs.get(session))?.status).toBe("running")

        // A takes the claim and extends. K116: it WAITS on that exact arm attempt.
        const promptA = yield* Effect.forkScoped(
          taskPrompt({
            tag: "A",
            jobs,
            attachments,
            session,
            admission: admissionA,
            run: runOf("A"),
            journal: log,
          }),
        )
        yield* until(Effect.sync(() => log.entered.includes("A")))
        const promptB = yield* Effect.forkScoped(
          taskPrompt({
            tag: "B",
            jobs,
            attachments,
            session,
            admission: admissionB,
            run: runOf("B"),
            journal: log,
          }),
        )
        yield* Effect.sleep(25)

        // THE ROW. A is a waiter on the sequence-zero arm; B is outside core entirely. The bind log
        // still holds exactly the seed's request, so B initiated no arm and reserved no sequence.
        expect(log.entered).toEqual(["A"])
        expect(yield* Ref.get(binds)).toEqual([0])

        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(seeding)
        expect(yield* Fiber.join(promptA)).toEqual({ kind: "extended" })
        expect(yield* Fiber.join(promptB)).toEqual({ kind: "updated" })
        expect(log.entered).toEqual(["A", "B"])
        // Sequence zero armed first and each later prompt took its own, in claim order.
        expect(yield* Ref.get(binds)).toEqual([0, 1, 2])

        yield* Deferred.succeed(releaseRun, undefined)
      }).pipe(
        Effect.provide(
          LayerNode.compile(
            LayerNode.group([
              SessionRunState.node,
              BackgroundJob.node,
              SessionClosure.node,
              SessionStatus.node,
              AttachmentCoordinator.node,
            ]),
            [
              [SessionClosure.node, closureLayer],
              [BackgroundJob.node, jobsLayer],
              [SessionStatus.node, statusStub],
            ],
          ),
        ),
        provideInstanceEffect(directory),
      )
    }).pipe(Effect.provide(services)),
  )

  /**
   * R-38's ordering, pinned to `task.ts` source rather than only to this harness.
   *
   * WHAT THIS ADDS THAT THE ROWS ABOVE CANNOT. Every row above proves a property of `taskPrompt`,
   * which mirrors `task.ts` by inspection. A future edit that hoists a core entry above
   * `attachments.claim` would leave every row green while breaking the production property outright
   * — R-38's first stop condition exactly. This is the one check that fails on that edit.
   *
   * ITS LIMIT, stated rather than left for a reader to discover: textual order is a proxy for
   * control flow, so this catches the HOISTING direction — a core entry moved above the claim — and
   * pins the call-site inventory so a new entry is visible. It cannot see a site that is textually
   * below the claim but outside its control flow. The behavioural oracle above covers the second
   * stop condition, and the two are complementary rather than redundant.
   */
  test("R-38: every BackgroundJob entry in task.ts is textually below the Task-local claim", () => {
    const source = readFileSync(join(import.meta.dir, "..", "..", "src", "tool", "task.ts"), "utf8")

    // Whitespace-tolerant by necessity, not by taste: `task.ts` writes two of these as
    // `background\n  .extendWithHandle({`, so a literal matcher silently misses admission sites
    // and reports the other two as absent rather than as misordered. A matcher that can miss
    // a site is worse than none here, because "nothing above the claim" would then be true of a
    // scan that never saw the sites that matter.
    const ENTRY = /background\s*\.\s*(promote|extend(?:WithHandle)?|startExact)\s*\(/g
    const CLAIM = /attachments\s*\.\s*claim\s*\(/g
    const AWAIT = /attachments\s*\.\s*awaitClaim\s*\(/g
    const scan = (text: string, pattern: RegExp) => Array.from(text.matchAll(new RegExp(pattern.source, "g")))

    /**
     * THE PREDICATE, factored so the discrimination check below runs THIS function rather than a
     * hand-written mirror of it. An oracle that restates its subject in different words proves the
     * two agree; one that re-runs the subject proves the subject fires.
     */
    const entriesAboveClaim = (text: string) => {
      const claims = scan(text, CLAIM)
      if (claims.length !== 1) return [`claim-sites:${claims.length}`]
      return scan(text, ENTRY)
        .filter((match) => match.index < claims[0]!.index)
        .map((match) => match[1]!)
    }

    // POSITIVE PRECONDITION. A moved file, a renamed symbol or a broken read would otherwise make
    // "nothing is above the claim" trivially true while inspecting nothing. The inventory is pinned
    // rather than merely counted, so an ADDED admission entry is visible here as well as a moved
    // one. Scoped to the three ADMISSION entries deliberately: `background.get`/`wait`/`waitExact`
    // are reads and observations that carry no arm, run or cancel authority, and `background.wait`
    // is legitimately constructed above the claim as a lazy observation value.
    expect(scan(source, CLAIM)).toHaveLength(1)
    expect(scan(source, AWAIT)).toHaveLength(1)
    expect(scan(source, ENTRY).map((match) => match[1]!)).toEqual([
      "promote",
      "extendWithHandle",
      "promote",
      "extendWithHandle",
      "startExact",
    ])
    expect(scan(source, AWAIT)[0]!.index).toBeGreaterThan(scan(source, CLAIM)[0]!.index)

    // R-38: no admission entry precedes the Task-local claim.
    expect(entriesAboveClaim(source)).toEqual([])

    // THE INSTRUMENT DISCRIMINATES, proven on the case it must fail: R-38's first stop condition,
    // simulated by hoisting a core entry above the claim. Without this the check above could be a
    // predicate that never reports anything - the vacuity this program has caught four times. The
    // mutation is in-memory; nothing on disk is touched.
    const hoisted = source.replace(
      "const attachments = ops.attachments",
      "yield* background.startExact(/* hoisted */)\n      const attachments = ops.attachments",
    )
    expect(hoisted).not.toBe(source)
    expect(entriesAboveClaim(hoisted)).toEqual(["startExact"])

    const legacy = source.replace(
      "const attachments = ops.attachments",
      "yield* background.extend(/* hoisted */)\n      const attachments = ops.attachments",
    )
    expect(legacy).not.toBe(source)
    expect(entriesAboveClaim(legacy)).toEqual(["extend"])
  })
})
