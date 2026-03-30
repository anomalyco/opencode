/**
 * FileWatcher stub — browser agent doesn't watch source code files.
 * This eliminates the parcel-watcher dependency which loads entire
 * file trees into memory (major RAM consumer).
 */

import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"

export namespace FileWatcher {
  export const Event = {
    Changed: BusEvent.define(
      "file.changed",
      z.object({
        type: z.enum(["create", "update", "delete"]),
        path: z.string(),
      }),
    ),
  }

  export interface Interface {
    readonly start: () => Effect.Effect<void>
    readonly stop: () => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@athena/FileWatcher") {}

  export const layer = Layer.succeed(
    Service,
    Service.of({
      start: () => Effect.void,
      stop: () => Effect.void,
    }),
  )

  export const defaultLayer = layer

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export const start = async () => {}
  export const stop = async () => {}
}
