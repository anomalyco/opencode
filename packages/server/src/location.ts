import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { Effect, Layer } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
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

function ref(request: HttpServerRequest.HttpServerRequest): Location.Ref | undefined {
  const query = new URL(request.url, "http://localhost").searchParams
  const workspaceID = query.get("location[workspace]") || request.headers["x-opencode-workspace"]
  const headerDirectory = request.headers["x-opencode-directory"]
  const directory = query.get("location[directory]") || (headerDirectory ? decode(headerDirectory) : undefined)
  if (directory === undefined) return undefined
  return Location.Ref.make({
    directory: AbsolutePath.make(directory),
    workspaceID: workspaceID ? WorkspaceV2.ID.make(workspaceID) : undefined,
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
        const location = ref(request)
        if (location === undefined) {
          return HttpServerResponse.jsonUnsafe(
            new InvalidRequestError({
              message: "Missing directory: set x-opencode-directory or location[directory]",
              kind: "Query",
              field: "location[directory]",
            }),
            { status: 400 },
          )
        }
        return yield* effect.pipe(Effect.provide(locations.get(location)))
      }),
    )
  }),
)
