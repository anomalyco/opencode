import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { LocationNotFoundError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { FSUtil } from "@opencode/util/fs-util"
import { Cause, Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { requestRef } from "../location"

export const LocationHandler = HttpApiBuilder.group(Api, "server.location", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const fs = yield* FSUtil.Service
    return handlers
      .handle(
        "location.get",
        Effect.fn(function* (ctx) {
          const ref = requestRef(ctx.request)
          const missing = () =>
            new LocationNotFoundError({ directory: ref.directory, message: `Location not found: ${ref.directory}` })
          const stat = yield* fs.stat(ref.directory).pipe(
            Effect.catchTag("PlatformError", (error) => {
              if (error.reason._tag === "NotFound") return missing()
              if (
                error.reason._tag === "BadResource" &&
                error.reason.cause instanceof Error &&
                "code" in error.reason.cause &&
                error.reason.cause.code === "ENOTDIR"
              )
                return missing()
              return Effect.die(error)
            }),
          )
          if (stat.type !== "Directory") return yield* missing()
          return yield* Effect.gen(function* () {
            const location = yield* Location.Service
            return new Location.Info({ directory: location.directory, project: location.project })
          }).pipe(Effect.provide(locations.get(ref)))
        }),
      )
      .handle("location.reload", () =>
        LocationServiceMap.reload().pipe(
          Effect.provideService(LocationServiceMap.Service, locations),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.fail(new ServiceUnavailableError({ message: Cause.pretty(cause), service: "location" })),
          ),
        ),
      )
  }),
)
