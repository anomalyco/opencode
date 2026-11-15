import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Generate } from "@opencode/schema/generate"
import type { Model } from "@opencode/schema/model"
import { Timestamps } from "../database/schema.sql.js"
import type { Generation } from "../generation.js"

export const GenerationTable = sqliteTable(
  "generation",
  {
    id: text().$type<Generate.GenerationID>().primaryKey(),
    kind: text().$type<Generation.Kind>().notNull(),
    model: text({ mode: "json" }).$type<Model.Ref>().notNull(),
    /** Set as soon as the provider accepts the job. A `submitting` row without it is never submitted again. */
    provider_job_id: text(),
    status: text().$type<Generation.Status>().notNull(),
    reason: text().$type<Generate.VideoErrorReason>(),
    error: text(),
    /** Hashes of the stored outputs, once `completed`. */
    media: text({ mode: "json" }).$type<ReadonlyArray<string>>(),
    request: text({ mode: "json" }).$type<Generation.Request>().notNull(),
    /** When the stored outputs may be deleted, once `completed`. */
    expires_at: integer(),
    ...Timestamps,
  },
  (table) => [index("generation_status_idx").on(table.status)],
)
