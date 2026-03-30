/**
 * Format stub — no-op replacement.
 * Browser agent doesn't format code files.
 */

import z from "zod"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"

export namespace Format {
  export const Status = z.object({
    id: z.string(),
    name: z.string(),
    running: z.boolean(),
    extensions: z.array(z.string()),
  })
  export type Status = z.infer<typeof Status>

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

  export const init = () => {}
  export const format = async (_file: string) => undefined
  export const file = async (_file: string) => {}
  export const status = async () => [] as Status[]
}
