export * as ShellJob from "./shell-job.js"

import { Context, Deferred, Effect, Layer, Scope } from "effect"
import { Node } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Job } from "../job.js"
import { Session } from "../session.js"
import { ShellResult } from "../shell/result.js"

type Recovery = Extract<Job.Recovery, { kind: "shell" }>

export interface Interface {
  readonly notify: (recovery: Recovery, settled: Deferred.Deferred<ShellResult.Output>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ShellJob") {}

const make = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const jobs = yield* Job.Service
  const scope = yield* Scope.Scope
  // Completion observers must survive the plugin and Location that launched the shell.
  const context = yield* Effect.context<never>()

  return Service.of({
    notify: Effect.fn("ShellJob.notify")(function* (
      recovery: Recovery,
      settled: Deferred.Deferred<ShellResult.Output>,
    ) {
      yield* Effect.gen(function* () {
        const info = (yield* jobs.wait({ id: recovery.shellID })).info
        if (!info || info.status === "running") return
        const output = info.status === "completed" ? yield* Deferred.await(settled) : undefined
        const text =
          info.status === "completed"
            ? (info.output ?? "Command completed")
            : info.status === "error"
              ? (info.error ?? "Command failed")
              : "Cancelled"
        yield* sessions.synthetic({
          ...(info.notificationID ? { id: info.notificationID } : {}),
          sessionID: recovery.sessionID,
          description: recovery.command,
          ...ShellResult.notification({
            jobID: info.id,
            shellID: recovery.shellID,
            command: recovery.command,
            state: info.status,
            text,
            output,
          }),
        })
        if (info.notificationID) yield* jobs.completeBackground(info.notificationID)
      }).pipe(Effect.forkIn(scope, { startImmediately: true }), Effect.setContext(context))
    }),
  })
})

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Session.node, Job.node],
})
