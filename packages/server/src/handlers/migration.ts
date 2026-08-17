import { V1Migration } from "@opencode-ai/core/database/v1-migration"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Effect } from "effect"
import { Api } from "../api"

export const MigrationHandler = HttpApiBuilder.group(Api, "server.migration", (handlers) =>
  handlers.handle(
    "migration.v1.status",
    Effect.fn(function* () {
      return yield* V1Migration.status()
    }),
  ),
)
