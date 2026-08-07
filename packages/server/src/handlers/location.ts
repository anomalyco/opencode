import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import os from "node:os"
import { Api } from "../api"

export const LocationHandler = HttpApiBuilder.group(Api, "server.location", (handlers) =>
  handlers.handle(
    "location.get",
    Effect.fn(function* () {
      const location = yield* Location.Service
      return new Location.Details({
        directory: location.directory,
        workspaceID: location.workspaceID,
        project: location.project,
        home: AbsolutePath.make(os.homedir()),
      })
    }),
  ),
)
