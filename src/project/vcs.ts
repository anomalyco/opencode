/**
 * VCS stub — browser agent doesn't track git branches.
 * Keeps the type exports so existing code compiles.
 */

import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"

export namespace Vcs {
  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({ branch: z.string().optional() }),
    ),
  }

  export const Info = z
    .object({ branch: z.string().optional() })
    .meta({ ref: "VcsInfo" })
  export type Info = z.infer<typeof Info>

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly branch: () => Effect.Effect<string | undefined>
    readonly info: () => Effect.Effect<Info>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@athena/Vcs") {}

  export const layer = Layer.succeed(
    Service,
    Service.of({
      init: () => Effect.void,
      branch: () => Effect.succeed(undefined),
      info: () => Effect.succeed({ branch: undefined }),
    }),
  )

  export const defaultLayer = layer

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export function init() {
    return runPromise((svc) => svc.init())
  }

  export function branch() {
    return runPromise((svc) => svc.branch())
  }
}
