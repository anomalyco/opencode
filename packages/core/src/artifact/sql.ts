import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Artifact } from "@opencode-ai/schema/artifact"
import { Timestamps } from "../database/schema.sql"
import { ProjectV2 } from "../project"
import { ProjectTable } from "../project/sql"
import type { SessionSchema } from "../session/schema"
import { SessionTable } from "../session/sql"

export const ArtifactTable = sqliteTable(
  "artifact",
  {
    id: text().$type<Artifact.ID>().primaryKey(),
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    // Session link drives comment delivery: a human comment on a linked
    // artifact is steered back to that session as actionable context. The
    // link clears instead of cascading so artifacts outlive their session.
    session_id: text()
      .$type<SessionSchema.ID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    name: text().notNull(),
    type: text().$type<Artifact.Type>().notNull(),
    status: text().$type<Artifact.Status>().notNull(),
    version: integer().notNull(),
    agent: text(),
    task: text(),
    content: text().notNull(),
    diff: text(),
    ...Timestamps,
  },
  (table) => [index("artifact_project_idx").on(table.project_id), index("artifact_session_idx").on(table.session_id)],
)

export const ArtifactCommentTable = sqliteTable(
  "artifact_comment",
  {
    id: text().$type<Artifact.CommentID>().primaryKey(),
    artifact_id: text()
      .$type<Artifact.ID>()
      .notNull()
      .references(() => ArtifactTable.id, { onDelete: "cascade" }),
    author: text().notNull(),
    body: text().notNull(),
    ...Timestamps,
  },
  (table) => [index("artifact_comment_artifact_idx").on(table.artifact_id)],
)
