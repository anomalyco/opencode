export * as Status from "./service-status"

import { ServiceStatus } from "@opencode-ai/protocol/groups/health"
import { Effect, Ref } from "effect"

export type State =
  | { readonly type: "starting" }
  | { readonly type: "ready" }
  | { readonly type: "stopping" }
  | { readonly type: "failed" }

export interface Interface {
  readonly current: Effect.Effect<State>
  readonly ready: Effect.Effect<void>
  readonly fail: Effect.Effect<void>
  readonly beginStopping: Effect.Effect<void>
  readonly requestStop: (request: ServiceStatus.StopRequest) => Effect.Effect<boolean>
}

export const make = Effect.fnUntraced(function* (options: {
  readonly instanceID: string
  readonly managed: boolean
  readonly initial?: State
}) {
  const current = yield* Ref.make(options.initial ?? ({ type: "starting" } satisfies State))
  const beginStopping = Ref.update(current, (status) =>
    status.type === "stopping" ? status : ({ type: "stopping" } satisfies State),
  )

  return {
    current: Ref.get(current),
    ready: Ref.update(current, (status) => (status.type === "starting" ? ({ type: "ready" } satisfies State) : status)),
    fail: Ref.update(current, (status) => (status.type === "starting" ? ({ type: "failed" } satisfies State) : status)),
    beginStopping,
    requestStop: (request) => {
      if (!options.managed || request.instanceID !== options.instanceID) return Effect.succeed(false)
      return beginStopping.pipe(Effect.as(true))
    },
  } satisfies Interface
})
