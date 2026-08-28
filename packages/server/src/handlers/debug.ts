import { InstanceMap } from "@opencode-ai/core/instance-map"
import { Effect, Option } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { requestRef } from "../location"

export const DebugHandler = HttpApiBuilder.group(Api, "server.debug", (handlers) =>
  handlers
    .handle(
      "debug.location",
      Effect.fn(function* () {
        const locations = Option.getOrThrow(yield* Effect.serviceOption(InstanceMap.Service))
        return (yield* locations.entries).map((entry) => entry.location)
      }),
    )
    .handle(
      "debug.location.evict",
      Effect.fn(function* (ctx) {
        const locations = Option.getOrThrow(yield* Effect.serviceOption(InstanceMap.Service))
        // Resolve through requestRef so the key matches the shape the location
        // middleware cached the services under.
        yield* locations.invalidate(requestRef(ctx.request))
      }),
    ),
)
