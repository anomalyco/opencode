import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Runner } from "@/effect/runner"
import { BackgroundJob } from "@/background/job"
import { Effect, Latch, Layer, Scope, Context } from "effect"
import { Session } from "./session"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"
// Type-only: the evidence shape is the closure ports contract's to define, and importing it keeps
// one definition rather than a structural copy that can silently drift. No runtime edge is created.
import type { SessionClosurePorts as Ports } from "./closure/ports"

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
  readonly ensureRunning: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    work: Effect.Effect<SessionV1.WithParts>,
  ) => Effect.Effect<SessionV1.WithParts>
  readonly startShell: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    work: Effect.Effect<SessionV1.WithParts>,
    ready?: Latch.Latch,
  ) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunState") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const status = yield* SessionStatus.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunState.state")(function* () {
        const scope = yield* Scope.Scope
        const runners = new Map<SessionID, Runner.Runner<SessionV1.WithParts>>()
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            yield* Effect.forEach(runners.values(), (runner) => runner.cancel, {
              concurrency: "unbounded",
              discard: true,
            })
            runners.clear()
          }),
        )
        return { runners, scope }
      }),
    )

    const runner = Effect.fn("SessionRunState.runner")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
    ) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing) return existing
      const next = Runner.make<SessionV1.WithParts>(data.scope, {
        onIdle: Effect.gen(function* () {
          data.runners.delete(sessionID)
          yield* status.set(sessionID, { type: "idle" })
        }),
        onBusy: status.set(sessionID, { type: "busy" }),
        onInterrupt,
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

    const ensureRunning = Effect.fn("SessionRunState.ensureRunning")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts>,
    ) {
      return yield* (yield* runner(sessionID, onInterrupt)).ensureRunning(work)
    })

    const startShell = Effect.fn("SessionRunState.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts>,
      ready?: Latch.Latch,
    ) {
      return yield* (yield* runner(sessionID, onInterrupt))
        .startShell(work, ready)
        .pipe(Effect.catchTag("RunnerBusy", () => Effect.fail(busyError(sessionID))))
    })

    return Service.of({ assertNotBusy, cancel, interruptRunner, listActive, ensureRunning, startShell })
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

export const node = LayerNode.make({ service: Service, layer: layer, deps: [BackgroundJob.node, SessionStatus.node] })

export * as SessionRunState from "./run-state"
