import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Environment } from "@opencode-ai/core/environment/index"
import { Workspace } from "@opencode-ai/core/workspace"
import { LocationDirectoryError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Api } from "../api"
import { requestRef } from "../location"

export const LocationHandler = HttpApiBuilder.group(Api, "server.location", (handlers) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const spawner = yield* ChildProcessSpawner
    const locations = yield* LocationServiceMap.Service
    return handlers.handle(
      "location.get",
      Effect.fn(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const ref = requestRef(request)
        const driver = ref.workspaceID
          ? yield* workspace.connect(ref.workspaceID).pipe(Effect.orDie)
          : Environment.makeLocalDriver(spawner)
        // Check the placement's filesystem before booting config, plugins, or MCP.
        // Those can fail independently and must never imply a missing directory.
        const kind = yield* Environment.typeFollowing(Environment.makeFiles(driver), ref.directory).pipe(
          Effect.catchTag(
            "Environment.NotFound",
            () =>
              new LocationDirectoryError({
                directory: ref.directory,
                reason: "not_found",
                message: `Directory not found: ${ref.directory}`,
              }),
          ),
          Effect.catchTag("Environment.Failed", (error) => Effect.die(error)),
        )
        if (kind !== "directory")
          return yield* new LocationDirectoryError({
            directory: ref.directory,
            reason: "not_directory",
            message: `Not a directory: ${ref.directory}`,
          })
        const location = yield* Location.Service.pipe(Effect.provide(locations.get(ref)))
        return new Location.Info({
          directory: location.directory,
          workspaceID: location.workspaceID,
          project: location.project,
        })
      }),
    )
  }),
)
