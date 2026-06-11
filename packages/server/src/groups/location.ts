import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Effect, Layer, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"

export const LocationQuery = Schema.Struct({
  location: Schema.optional(
    Schema.Struct({
      directory: Schema.optional(Schema.String),
      workspace: Schema.optional(Schema.String),
    }),
  ),
}).annotate({ identifier: "LocationQuery" })

export const locationQueryOpenApi = OpenApi.annotations({
  transform: (operation) => {
    const parameters = operation.parameters
    if (!Array.isArray(parameters)) return operation
    return {
      ...operation,
      parameters: parameters.map((parameter) =>
        parameter?.name === "location" && parameter?.in === "query"
          ? { ...parameter, style: "deepObject", explode: true }
          : parameter,
      ),
    }
  },
})

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

export type LocationServices = Layer.Success<ReturnType<typeof LocationServiceMap.get>>

export class LocationMiddleware extends HttpApiMiddleware.Service<
  LocationMiddleware,
  {
    provides: LocationServices
  }
>()("@opencode/HttpApiLocation") {}

export const LocationGroup = HttpApiGroup.make("server.location")
  .add(
    HttpApiEndpoint.get("location.get", "/api/location", {
      query: LocationQuery,
      success: Location.Info,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.location.get",
          summary: "Get location",
          description: "Resolve the requested location or the server default location.",
        }),
      ),
  )
  .middleware(LocationMiddleware)

function ref(request: HttpServerRequest.HttpServerRequest): Location.Ref {
  const query = new URL(request.url, "http://localhost").searchParams
  const workspaceID = query.get("location[workspace]") || request.headers["x-opencode-workspace"]
  return Location.Ref.make({
    directory: AbsolutePath.make(
      query.get("location[directory]") || request.headers["x-opencode-directory"] || process.cwd(),
    ),
    workspaceID: workspaceID ? WorkspaceV2.ID.make(workspaceID) : undefined,
  })
}

export const layer = Layer.effect(
  LocationMiddleware,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap
    return LocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        return yield* effect.pipe(Effect.provide(locations.get(ref(request))))
      }),
    )
  }),
)
