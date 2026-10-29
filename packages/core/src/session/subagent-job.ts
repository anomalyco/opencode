export * as SubagentJob from "./subagent-job.js"

import { Context, Effect, Layer } from "effect"
import { Node } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Job } from "../job.js"
import { Session } from "../session.js"
import { SessionExecution } from "./execution.js"
import type { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"
import { SubagentCompletion } from "./subagent-completion.js"

type Recovery = Extract<Job.Recovery, { kind: "subagent" }>

export interface Interface {
  start: (recovery: Recovery) => Effect.Effect<Job.Info>
  background: (recovery: Recovery) => Effect.Effect<void>
  notify: (recovery: Recovery, startedAt: number) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SubagentJob") {}

const make = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const jobs = yield* Job.Service
  const execution = yield* SessionExecution.Service
  const store = yield* SessionStore.Service
  // Jobs outlive the plugin that launched them; run with global context rather than caller Location.
  const context = yield* Effect.context<never>()

  const stopSubtree = (sessionID: SessionSchema.ID): Effect.Effect<void> =>
    Effect.gen(function* () {
      const children = yield* store.list({ parentID: sessionID })
      yield* sessions.interrupt(sessionID)
      yield* jobs.cancelSession(sessionID)
      yield* Effect.forEach(children, (child) => stopSubtree(child.id), { concurrency: 1, discard: true })
      yield* execution.awaitIdle(sessionID)
    }).pipe(Effect.ignoreCause)

  return Service.of({
    start: (recovery: Recovery) =>
      jobs
        .start({
          id: recovery.childSessionID,
          sessionID: recovery.parentSessionID,
          type: "subagent",
          title: recovery.description,
          metadata: { sessionID: recovery.parentSessionID, childSessionID: recovery.childSessionID },
          recovery,
          run: Effect.gen(function* () {
            while (true) {
              yield* sessions.resume(recovery.childSessionID)
              yield* jobs.awaitSessionBackground(recovery.childSessionID)
              if (!(yield* execution.isActive(recovery.childSessionID))) break
            }
            const messages = yield* sessions.messages({ sessionID: recovery.childSessionID, order: "desc", limit: 20 })
            const assistant = messages.find(
              (message) =>
                message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
            )
            return SubagentCompletion.text(assistant)
          }),
          output: sessions
            .messages({ sessionID: recovery.childSessionID, order: "desc", limit: 20 })
            .pipe(
              Effect.map(SubagentCompletion.progress),
              Effect.catchCause(() => Effect.succeed(undefined)),
            ),
          stop: stopSubtree(recovery.childSessionID),
          onSettle: (info) =>
            SubagentCompletion.deliver(sessions, jobs, {
              ...info,
              recovery,
              ...(info.status === "cancelled" ? { resume: false } : {}),
            }).pipe(Effect.ignore),
        })
        .pipe(Effect.setContext(context)),
    background: Effect.fn("SubagentJob.background")(function* (recovery: Recovery) {
      yield* jobs.background(recovery.childSessionID)
    }),
    notify: () => Effect.void,
  })
})

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Session.node, Job.node, SessionExecution.node, SessionStore.node],
})
