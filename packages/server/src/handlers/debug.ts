import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { ServiceUnavailableError, UnknownError } from "@opencode-ai/protocol/errors"
import { Global } from "@opencode-ai/util/global"
import { HeapSnapshot } from "@opencode-ai/util/heap-snapshot"
import { Effect, Option, RcMap } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { requestRef } from "../location"

export const DebugHandler = HttpApiBuilder.group(Api, "server.debug", (handlers) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    return handlers
      .handle(
        "debug.heapDump",
        Effect.fn(function* () {
          if (!HeapSnapshot.supported)
            return yield* new ServiceUnavailableError({
              message: "Heap snapshots are unsupported on this server runtime",
            })
          return yield* HeapSnapshot.write(global.log).pipe(
            Effect.tapError((cause) => Effect.logError("failed to write heap snapshot", { cause })),
            Effect.mapError(
              () => new UnknownError({ message: "Failed to write heap snapshot. Check server logs for details." }),
            ),
          )
        }),
      )
      .handle(
        "debug.location",
        Effect.fn(function* () {
          const locations = Option.getOrThrow(yield* Effect.serviceOption(LocationServiceMap.Service))
          return Array.from(yield* RcMap.keys(locations.rcMap))
        }),
      )
      .handle(
        "debug.location.evict",
        Effect.fn(function* (ctx) {
          const locations = Option.getOrThrow(yield* Effect.serviceOption(LocationServiceMap.Service))
          // Resolve through requestRef so the key matches the shape the location
          // middleware cached the services under.
          yield* locations.invalidate(requestRef(ctx.request))
        }),
      )
  }),
)
