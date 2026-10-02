import { FSUtil } from "@opencode/util/fs-util"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { LocationNotFoundError, LocationAccessDeniedError, InvalidRequestError } from "@opencode/protocol/errors"
import { Effect, Layer, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { missingSession } from "./handlers/session-error"

export type LocationServices = Layer.Success<ReturnType<(typeof LocationServiceMap.Service)["get"]>>

export class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware, { provides: LocationServices }>()(
  "@opencode/HttpApiLocation",
  { error: [LocationNotFoundError, LocationAccessDeniedError] },
) {}

export function locationErrors<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.catchIf(
      (error): error is Extract<E, FSUtil.DirectoryError> =>
        error instanceof FSUtil.DirectoryNotFoundError || error instanceof FSUtil.DirectoryAccessDeniedError,
      (error): Effect.Effect<never, LocationNotFoundError | LocationAccessDeniedError> =>
        Effect.fail(
          error instanceof FSUtil.DirectoryNotFoundError
            ? new LocationNotFoundError({
                location: { directory: AbsolutePath.make(error.directory) },
                message: `Location not found: ${error.directory}`,
              })
            : new LocationAccessDeniedError({
                location: { directory: AbsolutePath.make(error.directory) },
                message: `Access denied to location: ${error.directory}`,
              }),
        ),
    ),
  )
}

export function response<A, E, R>(data: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const location = yield* Location.Service
    return {
      location: new Location.Info({
        directory: location.directory,
        project: location.project,
      }),
      data: yield* data,
    }
  })
}

const decodeSessionID = Schema.decodeUnknownEffect(Session.ID)

export const sessionInfo = Effect.fnUntraced(function* (sessions: Session.Interface, sessionID: unknown) {
  const id = yield* decodeSessionID(sessionID).pipe(
    Effect.mapError(() => new InvalidRequestError({ message: "Invalid session ID", field: "sessionID" })),
  )
  return yield* sessions.get(id).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
})

export function requestRef(request: HttpServerRequest.HttpServerRequest): Location.Ref {
  const query = new URL(request.url, "http://localhost").searchParams
  const directory =
    query.get("location[directory]") ||
    (request.headers["x-opencode-directory"] ? decode(request.headers["x-opencode-directory"]) : process.cwd())
  return Location.Ref.make({
    directory: AbsolutePath.make(directory),
  })
}

function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

export const layer = Layer.effect(
  LocationMiddleware,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    return LocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        return yield* effect.pipe(Effect.provide(locations.get(requestRef(request))), locationErrors)
      }),
    )
  }),
)
