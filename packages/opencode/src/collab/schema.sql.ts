import { sqliteTable, text, integer, index, unique, primaryKey } from "drizzle-orm/sqlite-core"
import type { CollabRole, VisibilityMode, QueueMode, SuggestionStatus } from "@opencode-ai/collab"

export const CollabSessionTable = sqliteTable("collab_session", {
  id: text().primaryKey(),
  owner_github_id: integer().notNull(),
  owner_github_login: text().notNull(),
  name: text().notNull(),
  visibility_mode: text().$type<VisibilityMode>().notNull().default("submitted"),
  queue_mode: text().$type<QueueMode>().notNull().default("fifo"),
  session_id: text(),
  /** Git branch name created/used by this collab session in every linked repo. */
  branch: text(),
  /**
   * Workspace init lifecycle ("pending" | "ready" | "failed").
   * Iframe is gated on this becoming "ready".  See WorkspaceInitStatus in
   * @opencode-ai/collab and docs/adr/0001 for the rationale.
   * Legacy rows are backfilled to "ready" in runCollabMigrations.
   */
  init_status: text().notNull().default("pending"),
  /** Short human-readable error message when init_status === "failed". */
  init_error: text(),
  created_at: integer({ mode: "timestamp_ms" }).notNull(),
  deleted_at: integer({ mode: "timestamp_ms" }),
})

export const CollabParticipantTable = sqliteTable(
  "collab_participant",
  {
    collab_session_id: text()
      .notNull()
      .references(() => CollabSessionTable.id, { onDelete: "cascade" }),
    github_id: integer().notNull(),
    github_login: text().notNull(),
    github_avatar_url: text().notNull().default(""),
    role: text().$type<CollabRole>().notNull(),
    is_online: integer({ mode: "boolean" }).notNull().default(false),
    joined_at: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.collab_session_id, t.github_id] }),
    index("collab_participant_session_idx").on(t.collab_session_id),
  ],
)

export const CollabRepoTable = sqliteTable(
  "collab_repo",
  {
    id: text().primaryKey(),
    collab_session_id: text()
      .notNull()
      .references(() => CollabSessionTable.id, { onDelete: "cascade" }),
    repo_full_name: text().notNull(),
  },
  (t) => [index("collab_repo_session_idx").on(t.collab_session_id)],
)

export const CollabSuggestionTable = sqliteTable(
  "collab_suggestion",
  {
    id: text().primaryKey(),
    collab_session_id: text()
      .notNull()
      .references(() => CollabSessionTable.id, { onDelete: "cascade" }),
    author_github_id: integer().notNull(),
    author_github_login: text().notNull(),
    content: text().notNull(),
    status: text().$type<SuggestionStatus>().notNull().default("pending"),
    vote_score: integer().notNull().default(0),
    created_at: integer({ mode: "timestamp_ms" }).notNull(),
    /** e.g. "anthropic/claude-sonnet-4-5" — null means use the session default */
    model: text(),
    /** e.g. "build", "plan" — null means use the session default */
    agent: text(),
    /** e.g. "extended" — null means use the model default */
    variant: text(),
  },
  (t) => [index("collab_suggestion_session_idx").on(t.collab_session_id)],
)

export const CollabVoteTable = sqliteTable(
  "collab_vote",
  {
    id: text().primaryKey(),
    suggestion_id: text()
      .notNull()
      .references(() => CollabSuggestionTable.id, { onDelete: "cascade" }),
    voter_github_login: text().notNull(),
    created_at: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    unique("collab_vote_unique").on(t.suggestion_id, t.voter_github_login),
    index("collab_vote_suggestion_idx").on(t.suggestion_id),
  ],
)

/**
 * Lightweight emoji reactions on suggestions.  Distinct from CollabVoteTable
 * (which is the structured Vote-Pool ▲ count).  One row per
 * (suggestion, reactor, emoji) tuple — toggling re-adds or removes that row.
 */
export const CollabReactionTable = sqliteTable(
  "collab_reaction",
  {
    suggestion_id: text()
      .notNull()
      .references(() => CollabSuggestionTable.id, { onDelete: "cascade" }),
    voter_github_login: text().notNull(),
    emoji: text().notNull(),
    created_at: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.suggestion_id, t.voter_github_login, t.emoji] }),
    index("collab_reaction_suggestion_idx").on(t.suggestion_id),
  ],
)

/**
 * Side-channel team notes — separate from CollabSuggestionTable (which is
 * about prompts that may dispatch to the LLM).  A "note" is a short
 * human-to-human message that lives only in the left-panel team chat;
 * it never reaches opencode.  Used to coordinate via @-mentions without
 * burning an LLM turn.
 */
export const CollabNoteTable = sqliteTable(
  "collab_note",
  {
    id: text().primaryKey(),
    collab_session_id: text()
      .notNull()
      .references(() => CollabSessionTable.id, { onDelete: "cascade" }),
    author_github_id: integer().notNull(),
    author_github_login: text().notNull(),
    content: text().notNull(),
    created_at: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("collab_note_session_idx").on(t.collab_session_id)],
)

// Persisted GitHub OAuth sessions — survives server restarts.
// The in-memory Map used originally was wiped on every container restart.
export const CollabAuthSessionTable = sqliteTable("collab_auth_session", {
  token: text().primaryKey(),
  github_id: integer().notNull(),
  github_login: text().notNull(),
  github_avatar_url: text().notNull().default(""),
  github_access_token: text().notNull(),
  created_at: integer({ mode: "timestamp_ms" }).notNull(),
  expires_at: integer({ mode: "timestamp_ms" }).notNull(),
})

export const CollabInviteTable = sqliteTable("collab_invite", {
  token: text().primaryKey(),
  collab_session_id: text()
    .notNull()
    .references(() => CollabSessionTable.id, { onDelete: "cascade" }),
  role: text().$type<CollabRole>().notNull(),
  created_by: text().notNull(),
  expires_at: integer({ mode: "timestamp_ms" }),
  used_at: integer({ mode: "timestamp_ms" }),
  used_by: text(),
})
