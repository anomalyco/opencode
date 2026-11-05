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

export type Input = {
  readonly recovery: Recovery
  readonly notify: boolean
}

export interface Interface {
  start: (input: Input) => Effect.Effect<Job.Info>
  background: (input: Input) => Effect.Effect<void>
  notify: (recovery: Recovery, startedAt: number) => Effect.Effect<void>
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

  // Resume once for launch, then wait until the child is idle with no background work or input
  // left. Never resume just to inspect settlement: resuming an idle child runs another model step.
  const settle = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
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
    yield* sessions.resume(sessionID)
    while (true) {
      yield* sessions.wait(sessionID)
      // Read active last: input may have been promoted while the pending-work queries ran.
      const pending = yield* SessionBackground.unsettled(jobs, store, db, sessionID)
      const active = (yield* sessions.active).has(sessionID)
      const event = yield* Queue.poll(settled)
      if (Option.isSome(event)) {
        yield* terminal(event.value)
        continue
      }
      if (!pending && !active) return
      yield* terminal(yield* Queue.take(settled))
    }
  }, Effect.scoped)

  const notify = Effect.fn("SubagentJob.notify")(function* (recovery: Recovery, startedAt: number) {
    const key = `${recovery.childSessionID}:${startedAt}`
    if (notifications.has(key)) return
    notifications.add(key)
    yield* Effect.gen(function* () {
      const info = (yield* jobs.wait({ id: recovery.childSessionID })).info
      if (!info) return
      // The preference belongs to the spawn call, so read it after the child settles. A silent
      // child still clears its durable marker rather than leave a row that restart recovery
      // would replay as a report the parent asked not to receive.
      const metadata = yield* sessions.get(recovery.childSessionID).pipe(
        Effect.map((session) => session.metadata),
        Effect.catchTag("Session.NotFoundError", () => Effect.succeed(undefined)),
      )
      if (!SubagentMetadata.notify(metadata)) {
        if (info.notificationID) yield* jobs.completeBackground(info.notificationID)
        // Nothing reaches the parent, so wake it once idle: a parent whose report waited on this job
        // settles again and reports its final state, without running a model step. Waiting for idle
        // rather than skipping an active parent covers a settlement that read this job as running.
        const parentID = recovery.parentSessionID
        if (!(yield* store.get(parentID))) return
        yield* execution.awaitIdle(parentID)
        yield* execution.wake(parentID)
        return
      }
      yield* SubagentCompletion.deliver(sessions, jobs, { ...info, recovery })
    }).pipe(
      Effect.ensuring(Effect.sync(() => notifications.delete(key))),
      Effect.forkIn(scope, { startImmediately: true }),
      Effect.setContext(context),
    )
  })

  return Service.of({
    start: (input: Input) =>
      Effect.gen(function* () {
        yield* writeNotify(input.recovery, input.notify)
        return yield* jobs.start({
          id: input.recovery.childSessionID,
          type: "subagent",
          title: input.recovery.description,
          metadata: {},
          recovery: input.recovery,
          run: Effect.gen(function* () {
            yield* settle(input.recovery.childSessionID)
            const messages = yield* sessions.messages({
              sessionID: input.recovery.childSessionID,
              order: "desc",
              limit: 20,
            })
            const assistant = messages.find(
              (message) =>
                message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
            )
            return SubagentCompletion.text(assistant)
          }),
        })
      }).pipe(Effect.setContext(context)),
    background: Effect.fn("SubagentJob.background")(function* (input: Input) {
      yield* writeNotify(input.recovery, input.notify)
      const info = yield* jobs.background(input.recovery.childSessionID)
      if (info) yield* notify(input.recovery, info.started_at)
    }),
    notify,
  })
})

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Session.node, SessionExecution.node, Job.node, Bus.node, SessionStore.node, Database.node],
})
