export * as SubagentJob from "./subagent-job.js"

import { Context, Effect, Fiber, Layer, Scope, Stream } from "effect"
import { Node } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { Job } from "../job.js"
import { Session } from "../session.js"
import { SessionBackground } from "./background.js"
import { SessionEvent } from "./event.js"
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
  Session.Service | Job.Service | Bus.Service | SessionStore.Service | Database.Service | Scope.Scope
> = Effect.gen(function* () {
  const sessions = yield* Session.Service
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

  // Waits until the child stops for good: idle, with no background work or undelivered input left
  // to wake it. It only waits and never resumes, since resuming an idle child runs a model step.
  const settle = Effect.fnUntraced(function* (
    sessionID: SessionSchema.ID,
  ): Effect.fn.Return<void, Session.NotFoundError, Scope.Scope> {
    // Listen before waiting and checking, so a settlement in between still ends the wait below.
    const settled = yield* bus
      .subscribe([SessionEvent.Execution.Succeeded, SessionEvent.Execution.Failed, SessionEvent.Execution.Interrupted])
      .pipe(
        Stream.filter((event) => event.data.sessionID === sessionID),
        Stream.runHead,
        Effect.forkScoped({ startImmediately: true }),
      )
    yield* sessions.wait(sessionID)
    if (!(yield* sessions.active).has(sessionID) && !(yield* SessionBackground.unsettled(jobs, store, db, sessionID)))
      return
    yield* Fiber.join(settled)
    return yield* settle(sessionID)
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
            yield* sessions.resume(input.recovery.childSessionID)
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
  deps: [Session.node, Job.node, Bus.node, SessionStore.node, Database.node],
})
