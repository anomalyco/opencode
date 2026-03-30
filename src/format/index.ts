/**
 * Format stub — no-op replacement.
 * Browser agent doesn't format code files.
 */

import { Effect, Layer, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"

export namespace Format {
  export interface Interface {
    readonly format: (file: string) => Effect.Effect<string | undefined>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@athena/Format") {}

  export const layer = Layer.succeed(
    Service,
    Service.of({
      format: () => Effect.succeed(undefined),
    }),
  )

  export const defaultLayer = layer

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export const format = async (_file: string) => undefined
}
