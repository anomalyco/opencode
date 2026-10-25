import { DateTime } from "effect"
import { AgentV2 } from "../agent"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { ProjectV2 } from "../project"
import { ProviderV2 } from "../provider"
import { AbsolutePath, RelativePath } from "../schema"
import { WorkspaceV2 } from "../workspace"
import { SessionSchema } from "./schema"
import { SessionTable } from "./sql"
import { SessionMessage } from "./message"

export function fromRow(row: typeof SessionTable.$inferSelect): SessionSchema.Info {
  return SessionSchema.Info.make({
    id: row.id,
    projectID: row.project_id,
    title: row.title ?? undefined,
    parentID: row.parent_id ?? undefined,
    fork:
      row.fork_session_id && row.fork_boundary
        ? {
            sessionID: row.fork_session_id,
            boundary: row.fork_boundary,
          }
        : undefined,
    agent: row.agent ?? undefined,
    model: row.model
      ? {
          id: Model.ID.make(row.model.id),
          providerID: Provider.ID.make(row.model.providerID),
          variant: Model.VariantID.make(row.model.variant ?? "default"),
        }
      : undefined,
    cost: Money.USD.make(row.cost),
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: {
        read: row.tokens_cache_read,
        write: row.tokens_cache_write,
      },
    },
    location: {
      directory: AbsolutePath.make(row.directory),
      workspaceID: row.workspace_id ?? undefined,
    },
    subpath: row.path ? RelativePath.make(row.path) : undefined,
    metadata: row.metadata ?? undefined,
    permissions: row.permission ?? undefined,
    revert: row.revert ? decodeRevert(row.revert) : undefined,
    outcome: row.idle_outcome ?? undefined,
    time: {
      created: DateTime.makeUnsafe(row.time_created),
      updated: DateTime.makeUnsafe(row.time_updated),
      idle: row.time_idle === null ? undefined : DateTime.makeUnsafe(row.time_idle),
      viewed: row.time_viewed === null ? undefined : DateTime.makeUnsafe(row.time_viewed),
      archived: row.time_archived === null ? undefined : DateTime.makeUnsafe(row.time_archived),
    },
  })
}
