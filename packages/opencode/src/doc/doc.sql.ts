import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey, blob } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { SessionTable } from "../session/session.sql"
import type { SessionID } from "../session/schema"
import type { DocID, ActorID, AssetID, SubmitID, CycleID, CycleInputID } from "./schema"
import { Timestamps } from "../storage/schema.sql"

export const DocTable = sqliteTable("doc", {
  id: text().$type<DocID>().primaryKey(),
  kind: text().notNull(),
  ...Timestamps,
})

export const DocUpdateTable = sqliteTable(
  "doc_update",
  {
    id: text().primaryKey(),
    doc_id: text()
      .$type<DocID>()
      .notNull()
      .references(() => DocTable.id, { onDelete: "cascade" }),
    data: blob().notNull(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("doc_update_doc_idx").on(table.doc_id)],
)

export const SessionPromptDocTable = sqliteTable("session_prompt_doc", {
  session_id: text()
    .$type<SessionID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  doc_id: text()
    .$type<DocID>()
    .notNull()
    .references(() => DocTable.id, { onDelete: "cascade" }),
})

export const SessionActorTable = sqliteTable(
  "session_actor",
  {
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    actor_id: text().$type<ActorID>().notNull(),
    user_id: text(),
    name: text().notNull(),
    color: text().notNull(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_seen: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.actor_id] }),
    index("session_actor_session_idx").on(table.session_id),
  ],
)

export const DocAssetTable = sqliteTable(
  "doc_asset",
  {
    id: text().$type<AssetID>().notNull(),
    doc_id: text()
      .$type<DocID>()
      .notNull()
      .references(() => DocTable.id, { onDelete: "cascade" }),
    mime: text().notNull(),
    data: blob().notNull(),
    size: integer().notNull(),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.doc_id, table.id] }), index("doc_asset_doc_idx").on(table.doc_id)],
)

export const DocSubmitTable = sqliteTable(
  "doc_submit",
  {
    id: text().$type<SubmitID>().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    doc_id: text()
      .$type<DocID>()
      .notNull()
      .references(() => DocTable.id, { onDelete: "cascade" }),
    actor_id: text().$type<ActorID>().notNull(),
    status: text().notNull(),
    prompt: text().notNull(),
    timeout_ms: integer().notNull(),
    expires_at: integer().notNull(),
    cancelled_by: text().$type<ActorID>(),
    // The user message this submit produced once sent — links a cycle back to its submit/actors.
    user_message_id: text(),
    ...Timestamps,
  },
  (table) => [
    index("doc_submit_session_doc_status_idx").on(table.session_id, table.doc_id, table.status),
    index("doc_submit_expires_idx").on(table.expires_at),
    // At most one pending submit per (session, doc) — closes the concurrent-create race.
    uniqueIndex("doc_submit_pending_unique")
      .on(table.session_id, table.doc_id)
      .where(sql`${table.status} = 'pending'`),
  ],
)

// One row per AI run: the prompt that starts the run through to the AI's reply (or the user
// stopping it). Token/cost are the run's single usage total. The feeding prompt lives in
// prompt_cycle_input as a child row. Today exactly one input is recorded per run; the child
// table (with `seq`) is shaped to later hold multiple inputs for followup "steer" mode — where
// one run absorbs several prompts — which is NOT implemented yet.
export const PromptCycleTable = sqliteTable(
  "prompt_cycle",
  {
    id: text().$type<CycleID>().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    // docID is a per-input property (where the prompt was authored), so it lives on
    // prompt_cycle_input — not duplicated here.

    // One cycle per user prompt (turn). A turn may produce several assistant messages
    // (multi-step agent loop); they are all aggregated into this single cycle.
    user_message_id: text().notNull(),

    time_created: integer().notNull(), // cycle/run started (prompt authored)

    // ── 출력 (output) ──
    // The LAST assistant message of the turn (the others are folded into the aggregates).
    assistant_message_id: text().notNull(),
    response: text(), // full AI response text (steps joined), never summarized
    model_id: text(),
    provider_id: text(),
    time_output_start: integer(),
    time_completed: integer(), // completion incl. stop
    ttft_ms: integer(), // time_output_start - first consent

    // ── 토큰/비용 (tokens & cost) — summed across all steps of the turn ──
    tokens_input: integer(),
    tokens_output: integer(),
    tokens_reasoning: integer(),
    tokens_cache_read: integer(),
    tokens_cache_write: integer(),
    cost_total: real(),

    // ── 상태 (status) ──
    status: text().notNull().default("running"), // running | completed | aborted | error
    aborted: integer({ mode: "boolean" }).notNull().default(false),
    error: text(),
  },
  (table) => [
    index("prompt_cycle_session_idx").on(table.session_id),
    index("prompt_cycle_status_idx").on(table.status),
    index("prompt_cycle_created_idx").on(table.time_created),
    // One cycle per user prompt (turn) — idempotent upsert key for the recorder.
    uniqueIndex("prompt_cycle_user_message_unique").on(table.user_message_id),
  ],
)

// A single consented prompt that fed a cycle's run. Ordered by seq within the cycle.
export const PromptCycleInputTable = sqliteTable(
  "prompt_cycle_input",
  {
    id: text().$type<CycleInputID>().notNull(),
    cycle_id: text()
      .$type<CycleID>()
      .notNull()
      .references(() => PromptCycleTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionID>().notNull(),
    doc_id: text().$type<DocID>(), // null for non-doc prompts
    submit_id: text().$type<SubmitID>(),
    // Who sent/consented this prompt: [self] for a solo doc send, [a,b,...] for a multi-party
    // consent, null for non-doc (normal) prompts that carry no actor identity.
    actor_ids: text({ mode: "json" }).$type<ActorID[]>(),
    // Who initiated the send: the submit's creator (multi-party), or the lone sender (solo).
    initiator_actor_id: text().$type<ActorID>(),
    seq: integer().notNull().default(0), // input order within a run; always 0 today (see steer TODO)

    prompt: text().notNull(), // full prompt text, never summarized
    assets: text({ mode: "json" }).$type<{ assetID?: string; mime: string; filename?: string; url?: string }[]>(),
    actor_count: integer().notNull().default(1), // consent participants for this prompt
    user_message_id: text(),

    time_created: integer().notNull(), // prompt authored / user message created
    time_consented: integer(), // consent reached = sent to AI (doc mode only)
    consent_ms: integer(), // time_consented - time_created (doc mode only)
  },
  (table) => [
    primaryKey({ columns: [table.cycle_id, table.id] }),
    index("prompt_cycle_input_cycle_idx").on(table.cycle_id),
    index("prompt_cycle_input_session_idx").on(table.session_id),
  ],
)

export const DocSubmitActorTable = sqliteTable(
  "doc_submit_actor",
  {
    submit_id: text()
      .$type<SubmitID>()
      .notNull()
      .references(() => DocSubmitTable.id, { onDelete: "cascade" }),
    actor_id: text().$type<ActorID>().notNull(),
    name: text().notNull(),
    status: text().notNull(),
    time_responded: integer(),
  },
  (table) => [
    primaryKey({ columns: [table.submit_id, table.actor_id] }),
    index("doc_submit_actor_actor_idx").on(table.actor_id),
  ],
)
