import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql.js"
import type { Job } from "../job.js"
import type { SessionMessage } from "../session/message.js"
import type { SessionSchema } from "../session/schema.js"

// TODO: make the session link optional. A row is keyed by the session message that announces its result and is
// deleted once that message is delivered, so work with no session (session-less video generation) can't be recorded
// here and doesn't survive a restart.
export const JobTable = sqliteTable(
  "job",
  {
    notification_id: text().$type<SessionMessage.ID>().primaryKey(),
    id: text().notNull(),
    session_id: text().$type<SessionSchema.ID>().notNull(),
    child_session_id: text().$type<SessionSchema.ID>(),
    kind: text().notNull(),
    title: text(),
    status: text().$type<Job.Status>().notNull(),
    output: text(),
    error: text(),
    recovery: text({ mode: "json" }).$type<Job.Recovery>().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("job_session_idx").on(table.session_id),
    index("job_child_session_idx").on(table.child_session_id),
    index("job_id_idx").on(table.id),
  ],
)
