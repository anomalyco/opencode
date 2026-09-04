import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Runner } from "@/effect/runner"
import { BackgroundJob } from "@/background/job"
import { Session } from "./session"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"
import { SessionClosure } from "./closure/coordinator"
import { SessionAdmission } from "./closure/admission"
import { SessionClosureModel as Model } from "./closure/model"
import { SessionMutation } from "./closure/mutation"
import { SessionReplayPermit } from "./closure/replay-permit"
import * as RunService from "@/effect/run-service"
// Type-only: the evidence shape is the closure ports contract's to define, and importing it keeps
// one definition rather than a structural copy that can silently drift. No runtime edge is created.
import type { SessionClosurePorts as Ports } from "./closure/ports"
import { Context, Deferred, Effect, Exit, Latch, Layer, Scope, SynchronizedRef } from "effect"

/**
 * What the shared Runner store's work can refuse with.
 *
 * Both arms are refusals rather than faults: admission declined to admit the work, or a destructive
 * mutation was refused because a branch is closing.
 */
export type RunnerError = SessionClosure.AdmissionRefused | SessionMutation.MutationRefused

export type Published = Runner.Publication<SessionV1.WithParts, RunnerError>

type LifecycleState = {
  readonly closing: boolean
  readonly generations: ReadonlyMap<object, Effect.Effect<void>>
}

/** @internal Exact Instance-owned generation registry shared by every Session Runner. */
export interface GenerationLifecycle extends Runner.Lifecycle {
  readonly dispose: Effect.Effect<void>
  readonly inspect: Effect.Effect<{ readonly closing: boolean; readonly active: number }>
}

/** @internal Exported so deterministic lifecycle tests exercise the production registry itself. */
export const makeGenerationLifecycle = (): GenerationLifecycle => {
  const ref = SynchronizedRef.makeUnsafe<LifecycleState>({ closing: false, generations: new Map() })

  const register: Runner.Lifecycle["register"] = (token, dispose) =>
    SynchronizedRef.modify(ref, (current) => {
      if (current.closing) {
        const refused: Effect.Effect<void, Runner.Cancelled> = Effect.fail(new Runner.Cancelled())
        return [refused, current] as const
      }
      const generations = new Map(current.generations)
      generations.set(token, dispose)
      return [Effect.void, { closing: false, generations }] as const
    }).pipe(Effect.flatten)

  const unregister: Runner.Lifecycle["unregister"] = (token) =>
    SynchronizedRef.update(ref, (current) => {
      const generations = new Map(current.generations)
      generations.delete(token)
      return { closing: current.closing, generations }
    })

  const dispose = Effect.uninterruptible(
    SynchronizedRef.modify(
      ref,
      (current) =>
        [Array.from(current.generations.values()), { closing: true, generations: current.generations }] as const,
    ).pipe(
      Effect.flatMap((disposers) =>
        Effect.forEach(disposers, (close) => close.pipe(Effect.exit), { concurrency: "unbounded" }).pipe(
          Effect.flatMap((exits) => {
            const failed = exits.find(Exit.isFailure)
            return failed ? Effect.failCause(failed.cause) : Effect.void
          }),
        ),
      ),
      Effect.ensuring(SynchronizedRef.set(ref, { closing: true, generations: new Map() })),
    ),
  )

  const inspect = SynchronizedRef.get(ref).pipe(
    Effect.map((current) => ({ closing: current.closing, active: current.generations.size })),
  )

  return { register, unregister, dispose, inspect }
}

export interface Interface {
  readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void, Session.BusyError>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  /**
   * Interrupt one session's Runner without `cancel`'s recursive background-job sweep.
   *
   * That sweep is a graph walk, and a finalizer running inside the work being torn down cannot
   * perform one: the scope close that invoked the finalizer is awaiting it. Returns whether a
   * Runner was present, so a stale or absent target stays distinguishable from one that stopped.
   */
  readonly interruptRunner: (sessionID: SessionID) => Effect.Effect<boolean>
  /** Sessions holding a live Runner, reported per axis. Reads the Runner store, not a status projection. */
  readonly listActive: () => Effect.Effect<readonly Ports.RunnerActivity[]>
  /** Reply-required FIFO admission. Publication and result waiting are deliberately separate. */
  readonly publish: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    work: Effect.Effect<SessionV1.WithParts, SessionClosure.AdmissionRefused>,
    release: Deferred.Deferred<void>,
  ) => Effect.Effect<Published, RunnerError>
  readonly awaitPublished: (published: Published) => Effect.Effect<SessionV1.WithParts, RunnerError>
  readonly ensureRunning: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    // The work may itself refuse: a subtask admission raised inside the loop surfaces here.
    work: Effect.Effect<SessionV1.WithParts, SessionClosure.AdmissionRefused>,
    // The union is the shared Runner store's error parameter. The run loop cannot raise a mutation
    // refusal today, but the Runner it joins is the same one shell setup uses, so the seam's
    // declared return admits both.
  ) => Effect.Effect<SessionV1.WithParts, RunnerError>
  readonly startShell: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    // Shell setup runs revert cleanup, so the work may raise a destructive-mutation refusal.
    work: Effect.Effect<SessionV1.WithParts, SessionMutation.MutationRefused>,
    ready?: Latch.Latch,
  ) => Effect.Effect<SessionV1.WithParts, Session.BusyError | RunnerError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunState") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const status = yield* SessionStatus.Service
    const closure = yield* SessionClosure.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunState.state")(function* () {
        const scope = yield* Scope.Scope
        const lifecycle = makeGenerationLifecycle()
        // One store serves both seams, so its error parameter is the union of what either seam's
        // work can raise. Shell setup reaches revert cleanup, which is where the mutation refusal
        // comes from.
        const runners = new Map<SessionID, Runner.Runner<SessionV1.WithParts, RunnerError>>()
        yield* Effect.addFinalizer(() =>
          lifecycle.dispose.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                runners.clear()
              }),
            ),
          ),
        )
        return { runners, scope, lifecycle }
      }),
    )

    const runner = Effect.fn("SessionRunState.runner")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
    ) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing) return existing
      const next = Runner.make<SessionV1.WithParts, RunnerError>(data.scope, {
        onIdle: Effect.gen(function* () {
          data.runners.delete(sessionID)
          yield* status.set(sessionID, { type: "idle" })
        }),
        onBusy: status.set(sessionID, { type: "busy" }),
        onInterrupt,
        lifecycle: data.lifecycle,
      })
      data.runners.set(sessionID, next)
      return next
    })

    const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing?.busy) yield* busyError(sessionID)
    })

    const cancel = Effect.fn("SessionRunState.cancel")(function* (sessionID: SessionID) {
      yield* cancelBackgroundJobs(background, sessionID)
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (!existing) {
        yield* status.set(sessionID, { type: "idle" })
        return
      }
      yield* existing.cancel
    })

    const interruptRunner = Effect.fn("SessionRunState.interruptRunner")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (!existing) {
        // Status parity with `cancel`'s no-Runner branch, and truthful on its own terms: a session
        // with no Runner is idle. The `false` is what carries "nothing was interrupted" to the
        // caller; the status write does not claim otherwise.
        yield* status.set(sessionID, { type: "idle" })
        return false
      }
      yield* existing.cancel
      return true
    })

    const listActive = Effect.fn("SessionRunState.listActive")(function* () {
      const data = yield* InstanceState.get(state)
      return Array.from(data.runners, (entry) => ({ session: entry[0], tag: entry[1].state._tag }))
        .filter((item) => item.tag !== "Idle")
        .map((item) => ({
          session: item.session,
          running: item.tag === "Running" || item.tag === "ShellThenRun",
          shell: item.tag === "Shell" || item.tag === "ShellThenRun",
        }))
    })

    // `Model.AdmissionOwner` is scope | worker | job | participant and has no Runner or shell
    // variant, so both map onto a scope ID denoting the owning identity. Distinct per session and
    // per kind, because a session's Runner and its shell are different owners even though only one
    // of them can hold the session at a time.
    const owner = (kind: "runner" | "shell", sessionID: SessionID): Model.AdmissionOwner => ({
      type: "scope",
      id: Model.id("scope", `${kind}:${sessionID}`),
    })

    // Replace the pre-bind admission scope with whatever now owns the work, before that work can
    // escape coordinator observation. A misroute discovered here fails closed; the finalizer
    // installed by `admitted` then retires the lease it acquired.
    const bindTo = (
      context: SessionAdmission.Interface,
      kind: "runner" | "shell",
      sessionID: SessionID,
    ): Effect.Effect<void, SessionClosure.AdmissionRefused> =>
      Effect.forEach(context.leases, (lease) => closure.bind(lease, owner(kind, sessionID)), { discard: true }).pipe(
        Effect.catchTag("SessionClosureLocationError", () =>
          Effect.fail(new SessionClosure.AdmissionRefused({ session: sessionID, reason: "wrong_instance" })),
        ),
      )

    const ensureRunning = Effect.fn("SessionRunState.ensureRunning")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts, SessionClosure.AdmissionRefused>,
    ) {
      return yield* SessionAdmission.admitted(
        closure,
        { session: sessionID, origin: "internal", source: "SessionRunState.ensureRunning" },
        (context) =>
          Effect.gen(function* () {
            const current = yield* runner(sessionID, onInterrupt)
            yield* bindTo(context, "runner", sessionID)
            return yield* current.ensureRunning(work)
          }),
      )
    })

    const publish = Effect.fn("SessionRunState.publish")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts, SessionClosure.AdmissionRefused>,
      release: Deferred.Deferred<void>,
    ) {
      // `attach` is evaluated on the queuer's fiber before the entry can wait. It materializes the
      // effective Instance/Workspace references, including WorkspaceContext's JavaScript-local
      // fallback, into the Context captured immediately afterward.
      const queuer = yield* RunService.attach(Effect.context<never>())
      const current = yield* runner(sessionID, onInterrupt)
      return yield* current.publish(
        (generation) =>
          SessionAdmission.admitted(
            closure,
            {
              session: sessionID,
              origin: "internal",
              source: "SessionRunState.publish",
              reuseAmbient: false,
            },
            (context) =>
              Effect.gen(function* () {
                yield* bindTo(context, "runner", sessionID)
                return yield* work
              }),
          ).pipe(
            Effect.updateContext(() =>
              queuer.pipe(
                Context.omit(SessionAdmission.Service, SessionMutation.Active, SessionReplayPermit.Service),
                Context.add(Scope.Scope, generation),
              ),
            ),
          ),
        release,
      )
    })

    const awaitPublished = Effect.fn("SessionRunState.awaitPublished")(function* (published: Published) {
      if (published.type === "completed") return published.value
      return yield* published.await
    })

    const startShell = Effect.fn("SessionRunState.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts, SessionMutation.MutationRefused>,
      ready?: Latch.Latch,
    ) {
      return yield* SessionAdmission.admitted(
        closure,
        { session: sessionID, origin: "internal", source: "SessionRunState.startShell" },
        (context) =>
          Effect.gen(function* () {
            const current = yield* runner(sessionID, onInterrupt)
            yield* bindTo(context, "shell", sessionID)
            return yield* current
              .startShell(work, ready)
              .pipe(Effect.catchTag("RunnerBusy", () => Effect.fail(busyError(sessionID))))
          }),
      )
    })

    return Service.of({
      assertNotBusy,
      cancel,
      interruptRunner,
      listActive,
      publish,
      awaitPublished,
      ensureRunning,
      startShell,
    })
  }),
)

const cancelBackgroundJobs = Effect.fn("SessionRunState.cancelBackgroundJobs")(function* (
  background: BackgroundJob.Interface,
  sessionID: SessionID,
) {
  // Listing and cancelling are two operations, and a task job is filed under its session id, which
  // is reused when that session is resumed. Between the two a matched job can settle and a new one
  // can start under the same id, so cancelling by id would interrupt a run this sweep never matched.
  // It would also widen the walk incorrectly: `pending` grows from the metadata of what was
  // cancelled, so a replacement's metadata would pull in jobs from outside the requested branch.
  const jobs = yield* background.listExact()
  const pending = new Set<string>([sessionID])
  const cancelled = new Set<string>()
  const matches = (job: BackgroundJob.Info) => {
    if (job.status !== "running") return false
    if (cancelled.has(job.id)) return false
    if (pending.has(job.id)) return true
    if (typeof job.metadata?.sessionId === "string" && pending.has(job.metadata.sessionId)) return true
    return typeof job.metadata?.parentSessionId === "string" && pending.has(job.metadata.parentSessionId)
  }
  let batch = jobs.filter((entry) => matches(entry.info))
  while (batch.length > 0) {
    yield* Effect.forEach(
      batch,
      (entry) =>
        background.cancelExact(entry.lifetime).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              cancelled.add(entry.info.id)
              pending.add(entry.info.id)
              if (typeof entry.info.metadata?.sessionId === "string") pending.add(entry.info.metadata.sessionId)
            }),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    )
    batch = jobs.filter((entry) => matches(entry.info))
  }
})

function busyError(sessionID: SessionID) {
  return new Session.BusyError({ sessionID })
}

// This edge is `SessionClosure.node`, never the closure subsystem's own run-state adapter node.
// Closure reaches run-state's activity view through request-scoped ports rather than a layer
// dependency, so an edge in that direction would close a cycle.
export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [BackgroundJob.node, SessionStatus.node, SessionClosure.node],
})

export * as SessionRunState from "./run-state"
