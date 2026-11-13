import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { PublicInfo } from "@opencode/schema/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { ServiceUnavailableError } from "@opencode/protocol/errors"
import { Cause, Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"

export const LocationHandler = HttpApiBuilder.group(Api, "server.location", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    return handlers
      .handle(
        "location.get",
        Effect.fn(function* () {
          const location = yield* Location.Service
          return new PublicInfo({
            directory: location.directory,
            project: location.project,
            experimental: { tips_queue: yield* Flag.enabled("tips_queue") },
          })
        }),
      )
      .handle("location.reload", () =>
        LocationServiceMap.reload().pipe(
          Effect.provideService(LocationServiceMap.Service, locations),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)))
              : Effect.fail(new ServiceUnavailableError({ message: Cause.pretty(cause), service: "location" })),
          ),
        ),
      )
  }),
)
