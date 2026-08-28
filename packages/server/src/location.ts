import { Database } from "@opencode-ai/core/database/database"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Workspace } from "@opencode-ai/core/workspace"
import { InvalidRequestError, SessionNotFoundError } from "@opencode-ai/protocol/errors"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
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

export function sessionRef(database: Context.Service.Shape<typeof Database.Service>, sessionID: unknown) {
  return Effect.gen(function* () {
    const id = yield* decodeSessionID(sessionID).pipe(
      Effect.mapError(() => new InvalidRequestError({ message: "Invalid session ID", field: "sessionID" })),
    )
    const row = yield* database.db
      .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
      .from(SessionTable)
      .where(eq(SessionTable.id, id))
      .get()
      .pipe(Effect.orDie)
    if (!row) return yield* new SessionNotFoundError({ sessionID: id, message: `Session not found: ${id}` })
    return Location.Ref.make({
      directory: AbsolutePath.make(row.directory),
      workspaceID: row.workspaceID ? Workspace.ID.make(row.workspaceID) : undefined,
    })
  })
}

export function withLoadedLocationServices<A, E>(
  locations: Context.Service.Shape<typeof LocationServiceMap.Service>,
  ref: Location.Ref,
  effect: Effect.Effect<A, E, LocationServices>,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const context = yield* locations.contextEffectOption(ref)
      if (Option.isNone(context)) return Option.none<A>()
      return Option.some(yield* effect.pipe(Effect.provide(context.value)))
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
