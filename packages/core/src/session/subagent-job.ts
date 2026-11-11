export * as SubagentJob from "./subagent-job.js"

import { Context, Effect, Layer } from "effect"
import { Node } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { Job } from "../job.js"
import { SessionBackground } from "./background.js"
import { SessionExecution } from "./execution.js"
import type { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"
import { SubagentCompletion } from "./subagent-completion.js"

type Recovery = Extract<Job.Recovery, { kind: "subagent" }>

export type StartOptions = {
  readonly background?: boolean
}

export interface Interface {
  readonly outstanding: (sessionID: SessionSchema.ID) => Effect.Effect<readonly SessionBackground.OutstandingItem[]>
  readonly start: (recovery: Recovery, options?: StartOptions) => Effect.Effect<Job.Info>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SubagentJob") {}

const make = Effect.gen(function* () {
  const execution = yield* SessionExecution.Service
  const store = yield* SessionStore.Service
  const jobs = yield* Job.Service
  const { db } = yield* Database.Service
  // Jobs outlive the plugin that launched them. Fork with the global context too, rather
  // than retaining the caller's location.
  const context = yield* Effect.context<never>()

  const outstanding = (sessionID: SessionSchema.ID) =>
    Effect.gen(function* () {
      return yield* SessionBackground.outstanding(jobs, store, sessionID, yield* execution.active)
    })

  return Service.of({
    outstanding,
    start: (recovery, options) =>
      jobs
        .start({
          id: recovery.childSessionID,
          type: "subagent",
          title: recovery.description,
          metadata: {},
          recovery,
          background: options?.background,
          run: Effect.gen(function* () {
            const resume = execution.resume(recovery.childSessionID).pipe(
              // Only an explicit caller cancel releases the child's claim. A server shutdown
              // interrupts this job but must leave the child resumable on the next start.
              Effect.onInterrupt(() =>
                jobs
                  .isCancelled(recovery.childSessionID)
                  .pipe(
                    Effect.flatMap((cancelled) =>
                      cancelled ? execution.interrupt(recovery.childSessionID) : Effect.void,
                    ),
                  ),
              ),
            )
            if (options?.background) return yield* resume.pipe(Effect.as(""))
            // A joining period already owns its boundary; otherwise the child was admitted but not
            // resumed, so the latest durable sequence precedes everything this period will write.
            const startedSeq =
              (yield* execution.periodStartSeq(recovery.childSessionID)) ??
              (yield* Bus.latestSequence(db, recovery.childSessionID))
            yield* resume
            const assistant = yield* store.lastAssistantAfter({
              sessionID: recovery.childSessionID,
              afterSeq: startedSeq,
            })
            return SubagentCompletion.formatBody(
              SubagentCompletion.text(assistant),
              recovery.childSessionID,
              yield* outstanding(recovery.childSessionID),
            )
          }),
        })
        .pipe(Effect.setContext(context)),
  })
})

export const layer = Layer.effect(Service, make)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer,
  deps: [SessionExecution.node, SessionStore.node, Database.node, Job.node],
})
