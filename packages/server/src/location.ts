import { FileSystem } from "@opencode/core/filesystem"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { LocationNotFoundError, InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Duration, Effect, Layer, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiMiddleware } from "effect/http-api"
import { missingSession } from "./handlers/session-error"

export type LocationServices = Layer.Success<ReturnType<(typeof LocationServiceMap.Service)["get"]>>

export class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware, { provides: LocationServices }>()(
  "@opencode/HttpApiLocation",
  { error: [LocationNotFoundError] },
) {}

export function locationErrors<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.catchIf(
      (error): error is Extract<E, FileSystem.DirectoryNotFoundError> =>
        error instanceof FileSystem.DirectoryNotFoundError,
      (error) =>
        Effect.fail(
          new LocationNotFoundError({
            location: { directory: error.directory },
            message: `Location not found: ${error.directory}`,
          }),
        ),
    ),
  )
}

/** How long a location's plugins may take to activate before a request stops waiting for them. */
const defaultActivationBudget = Duration.seconds(5)

/**
 * Activation is paid once per location, so this budget only has to cover that one wait. A slow
 * or loaded machine can raise it with OPENCODE_PLUGIN_ACTIVATION_TIMEOUT, for example
 * "30 seconds"; an unreadable value keeps the default.
 */
export function activationBudget() {
  const configured = process.env.OPENCODE_PLUGIN_ACTIVATION_TIMEOUT?.trim()
  if (!configured) return defaultActivationBudget
  try {
    return Duration.fromInputUnsafe(configured as Duration.Input)
  } catch {
    return defaultActivationBudget
  }
}

export const awaitPlugins = Effect.suspend(() =>
  Plugin.awaitActivation.pipe(
    Effect.timeoutOrElse({
      duration: activationBudget(),
      orElse: () =>
        Effect.fail(
          new ServiceUnavailableError({
            message: "Location plugins did not finish activating",
            service: "plugin",
          }),
        ),
    }),
  ),
)

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
