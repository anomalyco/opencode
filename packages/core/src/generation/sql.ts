import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { GenerationID, VideoErrorReason } from "@opencode/schema/generate"
import type { Model } from "@opencode/schema/model"
import { Timestamps } from "../database/schema.sql.js"

export const GenerationTable = sqliteTable(
  "generation",
  {
    id: text().$type<GenerationID>().primaryKey(),
    kind: text().$type<"image" | "video">().notNull(),
    model: text({ mode: "json" }).$type<Model.Ref>().notNull(),
    /** Set as soon as the provider accepts the job. A `submitting` row without it is never submitted again. */
    provider_job_id: text(),
    /** `submitting` until the provider returns its job ID; clients see it as `running`. */
    status: text().$type<"submitting" | "running" | "completed" | "error">().notNull(),
    reason: text().$type<VideoErrorReason>(),
    error: text(),
    /** Hashes of the stored outputs, once `completed`. */
    media: text({ mode: "json" }).$type<ReadonlyArray<string>>(),
    /** Milliseconds the outputs stay available once the job completes; `expires_at` is set then. */
    retention: integer().notNull(),
    expires_at: integer(),
    ...Timestamps,
  },
  (table) => [index("generation_status_idx").on(table.status)],
)
