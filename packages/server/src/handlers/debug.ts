import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Effect, Option, RcMap } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const DebugHandler = HttpApiBuilder.group(Api, "server.debug", (handlers) =>
  handlers.handle(
    "debug.location",
    Effect.fn(function* () {
      const locations = Option.getOrThrow(yield* Effect.serviceOption(LocationServiceMap.Service))
      return Array.from(yield* RcMap.keys(locations.rcMap))
    }),
  ),
)
