import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { Workspace } from "@opencode-ai/core/workspace"
import { InvalidRequestError, SessionNotFoundError } from "@opencode-ai/protocol/errors"
import { Context, Effect, Layer, Option, RcMap, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"

export type LocationServices = Layer.Success<ReturnType<(typeof LocationServiceMap.Service)["get"]>>

export class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware, { provides: LocationServices }>()(
  "@opencode/HttpApiLocation",
) {}

export function response<A, E, R>(data: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const location = yield* Location.Service
    return {
      location: new Location.Info({
        directory: location.directory,
        workspaceID: location.workspaceID,
        project: location.project,
      }),
      data: yield* data,
    }
  })
}

const decodeSessionID = Schema.decodeUnknownEffect(Session.ID)

export function withLoadedSessionServices<A, E>(
  locations: Context.Service.Shape<typeof LocationServiceMap.Service>,
  sessions: Context.Service.Shape<typeof Session.Service>,
  sessionID: string,
  use: (context: Context.Context<LocationServices>) => Effect.Effect<A, E>,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const id = yield* decodeSessionID(sessionID).pipe(
        Effect.mapError(() => new InvalidRequestError({ message: "Invalid session ID", field: "sessionID" })),
      )
      const session = yield* sessions
        .get(id)
        .pipe(Effect.mapError(() => new SessionNotFoundError({ sessionID: id, message: `Session not found: ${id}` })))

      if (!(yield* RcMap.has(locations.rcMap, session.location))) return Option.none<A>()
      return Option.some(yield* use(yield* locations.contextEffect(session.location)))
    }),
  )
}

export function requestRef(request: HttpServerRequest.HttpServerRequest): Location.Ref {
  const query = new URL(request.url, "http://localhost").searchParams
  const workspaceID = query.get("location[workspace]") || request.headers["x-opencode-workspace"]
  const directory =
    query.get("location[directory]") ||
    (request.headers["x-opencode-directory"] ? decode(request.headers["x-opencode-directory"]) : process.cwd())
  return Location.Ref.make({
    directory: AbsolutePath.make(directory),
    workspaceID: workspaceID ? Workspace.ID.make(workspaceID) : undefined,
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
        return yield* effect.pipe(Effect.provide(locations.get(requestRef(request))))
      }),
    )
  }),
)
