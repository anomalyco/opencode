import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Artifact } from "@opencode/schema/artifact"
import type { Schema } from "effect"
import type { ProjectID } from "@opencode/schema/project-id"
import type { SessionID } from "@opencode/schema/session-id"
import { Timestamps } from "../database/schema.sql.js"

export const ArtifactTable = sqliteTable(
  "artifact",
  {
    id: text().$type<Artifact.ID>().primaryKey(),
    project_id: text().$type<ProjectID>().notNull(),
    /** The Session that published it. No foreign key: deleting that Session keeps the artifact. */
    session_id: text().$type<SessionID>(),
    directory: text().notNull(),
    provider: text().$type<Artifact.ProviderID>().notNull(),
    title: text().notNull(),
    entry: text().notNull(),
    url: text().notNull(),
    /** Null for an artifact published before providers declared their audiences. */
    visibility: text().$type<Artifact.Visibility>(),
    /** Where the provider published it, such as `cloudflare:<accountId>`. Updates and deletes refuse anywhere else. */
    destination: text(),
    manifest: text({ mode: "json" })
      .$type<Artifact.Manifest>()
      .notNull()
      .default({ spa: false, bindings: [], crons: [] }),
    /** What the provider returned, passed back to its later calls. */
    receipt: text({ mode: "json" }).$type<Schema.Json>(),
    ...Timestamps,
  },
  (table) => [
    index("artifact_project_idx").on(table.project_id, table.time_updated),
    index("artifact_session_idx").on(table.session_id),
  ],
)
