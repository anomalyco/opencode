import { V1Migration } from "@opencode-ai/core/database/v1-migration"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const MigrationHandler = HttpApiBuilder.group(Api, "server.migration", (handlers) =>
  handlers
    .handle("migration.v1.status", () => V1Migration.status())
    .handle("migration.v1.run", () => V1Migration.run()),
)
