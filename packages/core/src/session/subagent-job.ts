export * as SubagentJob from "./subagent-job.js"

import { Context, Effect, Layer } from "effect"
import { Node } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Job } from "../job.js"
import { SessionExecution } from "./execution.js"

type Recovery = Extract<Job.Recovery, { kind: "subagent" }>

export interface Interface {
  readonly start: (recovery: Recovery) => Effect.Effect<Job.Info>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SubagentJob") {}

export function start(
  jobs: Job.Interface,
  execution: SessionExecution.Interface,
  recovery: Recovery,
  notificationID?: Job.Background["notificationID"],
) {
  const id = recovery.childSessionID
  return jobs.start({
    id,
    type: "subagent",
    title: recovery.description,
    metadata: notificationID === undefined ? {} : undefined,
    recovery,
    notificationID,
    background: true,
    run: execution.resume(id).pipe(
      // Only an explicit caller cancel releases the child's claim. A server shutdown
      // interrupts this job but must leave the child resumable on the next start.
      Effect.onInterrupt(() =>
        jobs.isCancelled(id).pipe(Effect.flatMap((cancelled) => (cancelled ? execution.interrupt(id) : Effect.void))),
      ),
      Effect.as(""),
    ),
  })
}

const make = Effect.gen(function* () {
  const execution = yield* SessionExecution.Service
  const jobs = yield* Job.Service
  // Jobs outlive the plugin that launched them. Fork with the global context too, rather
  // than retaining the caller's location.
  const context = yield* Effect.context<never>()

  return Service.of({
    start: (recovery) => start(jobs, execution, recovery).pipe(Effect.setContext(context)),
  })
})

export const layer = Layer.effect(Service, make)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer,
  deps: [SessionExecution.node, Job.node],
})
