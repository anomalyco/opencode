export * as SubagentJob from "./subagent-job.js"

import { Context, Effect, Layer, Option, Queue, Scope, Stream } from "effect"
import { Node } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { Job } from "../job.js"
import { Session } from "../session.js"
import { SessionBackground } from "./background.js"
import { SessionEvent } from "./event.js"
import { SessionExecution } from "./execution.js"
import type { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"
import { SubagentCompletion } from "./subagent-completion.js"
import { SubagentMetadata } from "./subagent-metadata.js"

type Recovery = Extract<Job.Recovery, { kind: "subagent" }>

// A foreground continuation of a backgrounded child claims that child's running generation: it
// silences the busy period it waits for, then returns the answer itself.
export type Claim = {
  readonly generation: number
  readonly notify: boolean
}

export type Input = {
  readonly recovery: Recovery
  readonly notify: boolean
  readonly claimed?: Claim
}

type Completion = Pick<Job.Info, "status" | "output" | "error" | "notificationID"> & {
  readonly recovery: Recovery
  readonly resume?: boolean
}

export interface Interface {
  start: (input: Input) => Effect.Effect<Job.Info>
  recover: (input: {
    recovery: Recovery
    id: string
    notificationID: Job.Background["notificationID"]
  }) => Effect.Effect<void>
  complete: (input: Completion) => Effect.Effect<void, Session.NotFoundError | Session.SyntheticConflictError>
  background: (input: Input) => Effect.Effect<void>
  notify: (recovery: Recovery, startedAt: number) => Effect.Effect<void>
  claim: (recovery: Recovery) => Effect.Effect<Claim | undefined>
  release: (recovery: Recovery, claim: Claim) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SubagentJob") {}

const make: Effect.Effect<
  Interface,
  never,
  | Session.Service
  | SessionExecution.Service
  | Job.Service
  | Bus.Service
  | SessionStore.Service
  | Database.Service
  | Scope.Scope
> = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const execution = yield* SessionExecution.Service
  const jobs = yield* Job.Service
  const bus = yield* Bus.Service
  const store = yield* SessionStore.Service
  const db = (yield* Database.Service).db
  const scope = yield* Scope.Scope
  // Jobs and their completion observers outlive the plugin that launched them.
  // Fork with the global context too, rather than retaining the caller's location.
  const context = yield* Effect.context<never>()
  // One observer per job generation, including continuations of the same child.
  const notifications = new Set<string>()

  // Children inherit their parent's metadata (Session.create), so the per-spawn preference is
  // always written explicitly, merged over whatever the child already carries. This must run
  // before jobs.start, because that forks the child's run. A vanished child keeps the
  // never-error channel; jobs.start and the run surface a genuinely missing one.
  const writeNotify = Effect.fnUntraced(function* (recovery: Recovery, notify: boolean) {
    yield* Effect.gen(function* () {
      const session = yield* sessions.get(recovery.childSessionID)
      const metadata = SubagentMetadata.withNotify(session.metadata, notify)
      if (metadata) yield* sessions.setMetadata({ sessionID: recovery.childSessionID, metadata })
    }).pipe(Effect.catchTag("Session.NotFoundError", () => Effect.void))
  })

  // A foreground continuation of a running backgrounded child holds its own answer, so it silences
  // that busy period before its prompt is admitted: core settlement and the observer forked by the
  // original launch both read this preference, and either would report a duplicate. Only a
  // backgrounded generation carries a notificationID; a foreground generation keeps the block path.
  const claim = Effect.fn("SubagentJob.claim")(function* (recovery: Recovery) {
    const job = yield* jobs.get(recovery.childSessionID)
    if (job?.status !== "running" || job.notificationID === undefined) return undefined
    const session = yield* sessions
      .get(recovery.childSessionID)
      .pipe(Effect.catchTag("Session.NotFoundError", () => Effect.succeed(undefined)))
    if (session === undefined) return undefined
    const notify = SubagentMetadata.notify(session.metadata)
    if (SubagentMetadata.withNotify(session.metadata, false) !== undefined) yield* writeNotify(recovery, false)
    return { generation: job.started_at, notify }
  })

  // A prompt that never reached the child leaves the original launch owing its report.
  const release = (recovery: Recovery, claim: Claim) => writeNotify(recovery, claim.notify)

  // Resume once for launch, then wait until the child is idle. A backgrounded job also waits for
  // its background work and input, so its report carries the final answer; a foreground caller
  // takes the answer inline as soon as the child stops. Never resume just to inspect settlement:
  // resuming an idle child runs another model step.
  const settle = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, backgrounded: Effect.Effect<boolean>) {
    if (!(yield* store.get(sessionID))) return yield* new Session.NotFoundError({ sessionID })
    const outcomes = [
      SessionEvent.Execution.Succeeded,
      SessionEvent.Execution.Failed,
      SessionEvent.Execution.Interrupted,
    ] as const
    const settled = yield* Queue.make<Bus.SubscribePayload<typeof outcomes>>()
    // Keep one subscription across all busy periods, including the initial resume. wait() ignores
    // failures, so retain terminal outcomes rather than mistaking a failed follow-up for success.
    yield* bus.subscribe(outcomes).pipe(
      Stream.filter((event) => event.data.sessionID === sessionID),
      Stream.runForEach((event) => Queue.offer(settled, event)),
      Effect.forkScoped({ startImmediately: true }),
    )
    const terminal = Effect.fnUntraced(function* (event: Bus.SubscribePayload<typeof outcomes>) {
      if (event.type === SessionEvent.Execution.Failed.type)
        return yield* Effect.fail(new Error(event.data.error.message))
      if (event.type !== SessionEvent.Execution.Interrupted.type) return
      // Shutdown leaves the job's recovery marker to restart; it must not notify the parent.
      if (event.data.reason === "shutdown") return yield* Effect.never
      return yield* Effect.interrupt
    })
    yield* execution.resume(sessionID)
    while (true) {
      if (!(yield* store.get(sessionID))) return yield* new Session.NotFoundError({ sessionID })
      yield* execution.awaitIdle(sessionID)
      // Read active last: input may have been promoted while the pending-work queries ran.
      const pending = yield* SessionBackground.unsettled(jobs, store, db, sessionID)
      const active = yield* execution.isActive(sessionID)
      const event = yield* Queue.poll(settled)
      if (Option.isSome(event)) {
        yield* terminal(event.value)
        continue
      }
      // Backgrounding only ever turns on, so rereading it after each busy period sees a move.
      if (!active && (!pending || !(yield* backgrounded))) return
      yield* terminal(yield* Queue.take(settled))
    }
  }, Effect.scoped)

  const complete = Effect.fn("SubagentJob.complete")(function* (input: Completion) {
    const metadata = (yield* store.get(input.recovery.childSessionID))?.metadata
    if (!SubagentMetadata.notify(metadata)) {
      if (input.notificationID) yield* jobs.completeBackground(input.notificationID)
      // A settlement may have seen this job still running. Clear its marker before waking
      // the idle parent, so a held report gets another chance to release without a model step.
      const parentID = input.recovery.parentSessionID
      if (!(yield* store.get(parentID))) return
      yield* execution.awaitIdle(parentID)
      yield* execution.wake(parentID)
      return
    }
    yield* SubagentCompletion.deliver(
      {
        synthetic: (notice) =>
          Effect.gen(function* () {
            yield* sessions.synthetic({ ...notice, resume: false })
            if (notice.resume !== false && !(yield* sessions.get(notice.sessionID)).revert)
              yield* execution.wake(notice.sessionID)
          }).pipe(Effect.uninterruptible),
      },
      jobs,
      input,
    )
  })

  const notify = Effect.fn("SubagentJob.notify")(function* (
    recovery: Recovery,
    startedAt: number,
    id: string = recovery.childSessionID,
  ) {
    const key = `${id}:${startedAt}`
    if (notifications.has(key)) return
    notifications.add(key)
    yield* Effect.gen(function* () {
      const info = (yield* jobs.wait({ id })).info
      if (!info) return
      // Scope shutdown cancels only the in-memory job. Its running durable row must survive
      // for the next process, unlike an explicit cancellation persisted by Job.cancel.
      if (
        info.status === "cancelled" &&
        (yield* jobs.pendingBackground).some(
          (row) => row.status === "running" && (row.notificationID === info.notificationID || row.id === id),
        )
      )
        return
      yield* complete({ ...info, recovery })
    }).pipe(
      Effect.ensuring(Effect.sync(() => notifications.delete(key))),
      Effect.forkIn(scope, { startImmediately: true }),
      Effect.setContext(context),
    )
  })

  const run = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, backgrounded: Effect.Effect<boolean>) {
    yield* settle(sessionID, backgrounded)
    const messages = yield* store.messages({ sessionID, order: "desc", limit: 20 })
    return SubagentCompletion.text(
      messages.find(
        (message) =>
          message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
      ),
    )
  })

  return Service.of({
    recover: (input) =>
      Effect.gen(function* () {
        const info = yield* jobs.start({
          id: input.id,
          type: "subagent",
          title: input.recovery.description,
          notificationID: input.notificationID,
          recovery: input.recovery,
          // Held from the first check: a recovered child is usually already idle when the run starts.
          run: run(input.recovery.childSessionID, Effect.succeed(true)),
        })
        yield* jobs.background(input.id)
        yield* notify(input.recovery, info.started_at, input.id)
      }).pipe(Effect.setContext(context)),
    complete,
    start: (input: Input) =>
      Effect.gen(function* () {
        // A claim keeps the child silent until its foreground caller returns the answer. Writing the
        // caller's own preference here would reopen the duplicate report the claim exists to prevent.
        yield* writeNotify(input.recovery, input.claimed ? false : input.notify)
        const info = yield* jobs.start({
          id: input.recovery.childSessionID,
          type: "subagent",
          title: input.recovery.description,
          metadata: {},
          recovery: input.recovery,
          run: run(input.recovery.childSessionID, jobs.isBackgrounded(input.recovery.childSessionID)),
        })
        // The claimed generation settled before the join, so start forked a new foreground
        // generation: it reports through its own blocker, and this call's preference comes back.
        if (input.claimed && info.started_at !== input.claimed.generation)
          yield* writeNotify(input.recovery, input.notify)
        return info
      }).pipe(Effect.setContext(context)),
    background: Effect.fn("SubagentJob.background")(function* (input: Input) {
      yield* writeNotify(input.recovery, input.notify)
      const info = yield* jobs.background(input.recovery.childSessionID)
      if (info) yield* notify(input.recovery, info.started_at)
    }),
    notify,
    claim,
    release,
  })
})

export const layer = Layer.effect(Service, make)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer,
  deps: [Session.node, SessionExecution.node, Job.node, Bus.node, SessionStore.node, Database.node],
})
