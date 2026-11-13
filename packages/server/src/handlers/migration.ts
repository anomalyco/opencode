import { V1Migration } from "@opencode/core/database/v1-migration"
import { SessionSearchBuild } from "@opencode/core/session/search-build"
import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Api } from "../api"

export const MigrationHandler = HttpApiBuilder.group(Api, "server.migration", (handlers) =>
  Effect.gen(function* () {
    const build = yield* SessionSearchBuild.Service
    return handlers
      .handle(
        "migration.v1.status",
        Effect.fn(function* () {
          return yield* V1Migration.status()
        }),
      )
      .handle("migration.sessionSearch.status", () => build.status)
  }),
)
