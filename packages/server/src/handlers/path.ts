import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/util/global"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const PathHandler = HttpApiBuilder.group(Api, "server.path", (handlers) =>
  handlers.handle("path.get", () =>
    Effect.gen(function* () {
      const global = yield* Global.Service
      const location = yield* Location.Service
      return {
        home: AbsolutePath.make(global.home),
        state: AbsolutePath.make(global.state),
        config: AbsolutePath.make(global.config),
        worktree: location.project.directory,
        directory: location.directory,
      }
    }),
  ),
)
