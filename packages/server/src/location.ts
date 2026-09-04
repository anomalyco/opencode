import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { ServerDirectory } from "./server-directory"

export type LocationServices = Layer.Success<ReturnType<(typeof LocationServiceMap.Service)["get"]>>

type DirectoryHint = {
  readonly source: "query" | "header" | "default"
  readonly value: string
}

export class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware, { provides: LocationServices }>()(
  "@opencode/HttpApiLocation",
  { error: [InvalidRequestError] },
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

function ref(request: HttpServerRequest.HttpServerRequest): Location.Ref | InvalidRequestError {
  const query = new URL(request.url, "http://localhost").searchParams
  const directory = parseDirectoryHint(directoryHint(request, query))
  if (directory instanceof InvalidRequestError) return directory
  const workspaceID = query.get("location[workspace]") || request.headers["x-opencode-workspace"]
  return Location.Ref.make({
    directory: AbsolutePath.make(directory),
    workspaceID: workspaceID ? WorkspaceV2.ID.make(workspaceID) : undefined,
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
    return invalidDirectoryError(hint, target, error)
  }
}

function invalidDirectoryError(hint: DirectoryHint, target: ServerDirectory.Profile, error: unknown) {
  return new InvalidRequestError({
    message: invalidDirectoryMessage(target, error),
    kind: hint.source === "query" ? "Query" : "Header",
    field: "location[directory]",
  })
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
        const location = ref(request)
        if (location instanceof InvalidRequestError) return yield* location
        return yield* effect.pipe(Effect.provide(locations.get(location)))
      }),
    )
  }),
)
