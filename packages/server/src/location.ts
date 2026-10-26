import { FileSystem } from "@opencode/core/filesystem"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { LocationNotFoundError, InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Effect, Layer, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiMiddleware } from "effect/http-api"
import { missingSession } from "./handlers/session-error"
import { ServerDirectory } from "./server-directory"

export type LocationServices = Layer.Success<ReturnType<(typeof LocationServiceMap.Service)["get"]>>

export class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware, { provides: LocationServices }>()(
  "@opencode/HttpApiLocation",
  { error: [LocationNotFoundError, InvalidRequestError] },
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

export const awaitPlugins = Plugin.awaitActivation.pipe(
  Effect.timeoutOrElse({
    duration: "5 seconds",
    orElse: () =>
      Effect.fail(
        new ServiceUnavailableError({
          message: "Location plugins did not finish activating",
          service: "plugin",
        }),
      ),
  }),
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

type DirectoryHint = {
  readonly source: "query" | "header" | "default"
  readonly value: string
}

export function requestRef(request: HttpServerRequest.HttpServerRequest): Location.Ref | InvalidRequestError {
  const query = new URL(request.url, "http://localhost").searchParams
  const directory = parseDirectoryHint(directoryHint(request, query))
  if (directory instanceof InvalidRequestError) return directory
  return Location.Ref.make({
    directory: AbsolutePath.make(directory),
  })
}

function directoryHint(request: HttpServerRequest.HttpServerRequest, query: URLSearchParams): DirectoryHint {
  const directory = query.get("location[directory]")
  if (directory) return { source: "query", value: directory }
  const header = request.headers["x-opencode-directory"]
  if (!header) return { source: "default", value: process.cwd() }
  return { source: "header", value: decode(header) }
}

function parseDirectoryHint(hint: DirectoryHint) {
  if (hint.source === "default") return hint.value
  const target = ServerDirectory.profile()
  try {
    return ServerDirectory.parse(hint.value, target)
  } catch (error) {
    return new InvalidRequestError({
      message: invalidDirectoryMessage(target, error),
      kind: hint.source === "query" ? "Query" : "Header",
      field: "location[directory]",
    })
  }
}

function invalidDirectoryMessage(target: ServerDirectory.Profile, error: unknown) {
  if (error instanceof ServerDirectory.ParseError && error.reason === "drive-relative") {
    return "The directory must be an absolute path, not a Windows drive-relative path"
  }
  if (error instanceof ServerDirectory.ParseError && error.reason === "foreign" && target.kind === "wsl") {
    return "The directory uses a Windows path, but this OpenCode server expects a WSL/POSIX path. Select the directory using the server picker or use /mnt/<drive>/..."
  }
  if (error instanceof ServerDirectory.ParseError && error.reason === "foreign") {
    return "The directory uses a path syntax that is not native to this OpenCode server"
  }
  return "The directory must be a valid server-native path"
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
        const ref = requestRef(request)
        if (ref instanceof InvalidRequestError) return yield* ref
        return yield* effect.pipe(Effect.provide(locations.get(ref)), locationErrors)
      }),
    )
  }),
)
