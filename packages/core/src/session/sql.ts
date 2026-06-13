import { table, text, integer, index, primaryKey, real, uniqueIndex, Timestamps } from "../database/dialect"
import * as DatabasePath from "../database/path"
import { ProjectTable } from "../project/sql"
import type { SessionMessage } from "./message"
import type { Prompt } from "./prompt"
import type { SessionInput } from "./input"
import type { Snapshot } from "../snapshot"
import { PermissionV1 } from "../v1/permission"
import { ProjectV2 } from "../project"
import type { SessionSchema } from "./schema"
import type { MessageID, PartID, SessionV1 } from "../v1/session"
import { WorkspaceV2 } from "../workspace"
import type { SystemContext } from "../system-context/index"
import { AgentV2 } from "../agent"

type SessionMessageData = Omit<(typeof SessionMessage.Message)["Encoded"], "type" | "id">
type V1MessageData = Omit<SessionV1.Info, "id" | "sessionID">
type V1PartData = Omit<SessionV1.Part, "id" | "sessionID" | "messageID">

const SessionTable = table(
  "session",
  {
    id: text().$type<SessionSchema.ID>().primaryKey(),
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    workspace_id: text().$type<WorkspaceV2.ID>(),
    parent_id: text().$type<SessionSchema.ID>(),
    slug: text().notNull(),
    directory: DatabasePath.directoryColumn().notNull(),
    path: DatabasePath.pathColumn(),
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }).$type<Snapshot.FileDiff[]>(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    cost: real().notNull().default(0),
    tokens_input: integer().notNull().default(0),
    tokens_output: integer().notNull().default(0),
    tokens_reasoning: integer().notNull().default(0),
    tokens_cache_read: integer().notNull().default(0),
    tokens_cache_write: integer().notNull().default(0),
    revert: text({ mode: "json" }).$type<{ messageID: MessageID; partID?: PartID; snapshot?: string; diff?: string }>(),
    permission: text({ mode: "json" }).$type<PermissionV1.Ruleset>(),
    agent: text(),
    model: text({ mode: "json" }).$type<{
      id: string
      providerID: string
      variant?: string
    }>(),
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer(),
  },
  (t) => [
    index("session_project_idx").on(t.project_id),
    index("session_workspace_idx").on(t.workspace_id),
    index("session_parent_idx").on(t.parent_id),
  ],
)

const MessageTable = table(
  "message",
  {
    id: text().$type<MessageID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<V1MessageData>(),
  },
  (t) => [index("message_session_time_created_id_idx").on(t.session_id, t.time_created, t.id)],
)

const PartTable = table(
  "part",
  {
    id: text().$type<PartID>().primaryKey(),
    message_id: text()
      .$type<MessageID>()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionSchema.ID>().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<V1PartData>(),
  },
  (t) => [
    index("part_message_id_id_idx").on(t.message_id, t.id),
    index("part_session_idx").on(t.session_id),
  ],
)

const TodoTable = table(
  "todo",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.session_id, t.position] }),
    index("todo_session_idx").on(t.session_id),
  ],
)

const SessionMessageTable = table(
  "session_message",
  {
    id: text().$type<SessionMessage.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    type: text().$type<SessionMessage.Type>().notNull(),
    seq: integer().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<SessionMessageData>(),
  },
  (t) => [
    uniqueIndex("session_message_session_seq_idx").on(t.session_id, t.seq),
    index("session_message_session_type_seq_idx").on(t.session_id, t.type, t.seq),
    index("session_message_session_time_created_id_idx").on(t.session_id, t.time_created, t.id),
    index("session_message_time_created_idx").on(t.time_created),
  ],
)

const SessionInputTable = table(
  "session_input",
  {
    id: text().$type<SessionMessage.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    prompt: text({ mode: "json" }).notNull().$type<Prompt>(),
    delivery: text().$type<SessionInput.Delivery>().notNull(),
    admitted_seq: integer().notNull(),
    promoted_seq: integer(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (t) => [
    index("session_input_session_pending_delivery_seq_idx").on(
      t.session_id,
      t.promoted_seq,
      t.delivery,
      t.admitted_seq,
    ),
    uniqueIndex("session_input_session_admitted_seq_idx").on(t.session_id, t.admitted_seq),
    uniqueIndex("session_input_session_promoted_seq_idx").on(t.session_id, t.promoted_seq),
  ],
)

const SessionContextEpochTable = table("session_context_epoch", {
  session_id: text()
    .$type<SessionSchema.ID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  baseline: text().notNull(),
  agent: text().$type<AgentV2.ID>().notNull().default(AgentV2.defaultID),
  snapshot: text({ mode: "json" }).notNull().$type<SystemContext.Snapshot>(),
  baseline_seq: integer().notNull(),
  replacement_seq: integer(),
  revision: integer().notNull().default(0),
})

export { SessionTable, MessageTable, PartTable, TodoTable, SessionMessageTable, SessionInputTable, SessionContextEpochTable }
