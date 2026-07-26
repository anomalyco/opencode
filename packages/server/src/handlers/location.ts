import { Location } from "@opencode-ai/core/location"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const LocationHandler = HttpApiBuilder.group(Api, "server.location", (handlers) =>
  handlers.handle(
    "location.get",
    Effect.fn(function* () {
      const location = yield* Location.Service
      return new Location.Info({
        directory: location.directory,
        workspaceID: location.workspaceID,
        project: location.project,
      })
    }),
  ),
)
