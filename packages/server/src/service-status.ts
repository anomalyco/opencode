export * as Status from "./service-status"

import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { ServiceStatus } from "@opencode-ai/protocol/groups/health"
import { Effect, Ref } from "effect"

export interface Interface {
  readonly health: Effect.Effect<ServiceStatus.Health>
  readonly current: Effect.Effect<ServiceStatus.State>
  readonly ready: Effect.Effect<void>
  readonly fail: (failure: { readonly message: string; readonly action: string }) => Effect.Effect<void>
  readonly beginStopping: (targetVersion?: string) => Effect.Effect<void>
  readonly requestStop: (request: ServiceStatus.StopRequest) => Effect.Effect<boolean>
}

export const make = Effect.fnUntraced(function* (options: {
  readonly instanceID: string
  readonly managed: boolean
  readonly onStop: Effect.Effect<void>
  readonly initial?: ServiceStatus.State
}) {
  const current = yield* Ref.make(options.initial ?? ({ type: "starting" } satisfies ServiceStatus.State))
  const transitionToStopping = (targetVersion?: string) =>
    Ref.modify(current, (status) => {
      if (status.type === "stopping") return [false, status]
      const next = (
        targetVersion === undefined || targetVersion === InstallationVersion
          ? { type: "stopping" }
          : { type: "stopping", targetVersion }
      ) satisfies ServiceStatus.State
      return [true, next]
    })

  return {
    current: Ref.get(current),
    health: Effect.gen(function* () {
      return {
        healthy: true as const,
        version: InstallationVersion,
        pid: process.pid,
        instanceID: options.instanceID,
        status: yield* Ref.get(current),
      }
    }),
    ready: Ref.update(current, (status) =>
      status.type === "starting" ? ({ type: "ready" } satisfies ServiceStatus.State) : status,
    ),
    fail: (failure) =>
      Ref.update(current, (status) =>
        status.type === "starting" ? ({ type: "failed", ...failure } satisfies ServiceStatus.State) : status,
      ),
    beginStopping: (targetVersion?: string) => transitionToStopping(targetVersion).pipe(Effect.asVoid),
    requestStop: (request) => {
      if (!options.managed || request.instanceID !== options.instanceID) return Effect.succeed(false)
      return transitionToStopping(request.targetVersion).pipe(
        Effect.flatMap((changed) =>
          changed ? options.onStop.pipe(Effect.delay("25 millis"), Effect.forkDetach, Effect.asVoid) : Effect.void,
        ),
        Effect.as(true),
      )
    },
  } satisfies Interface
})
