import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { EffectDrizzlePg } from "@opencode-ai/effect-drizzle-pg"

type PgDatabase = EffectDrizzlePg.EffectPgDatabase

export function bootstrapPg(db: PgDatabase) {
  return Effect.gen(function* () {
    yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "project" (
  "id" text PRIMARY KEY,
  "worktree" text NOT NULL,
  "vcs" text,
  "name" text,
  "icon_url" text,
  "icon_url_override" text,
  "icon_color" text,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL,
  "time_initialized" bigint,
  "sandboxes" text NOT NULL,
  "commands" jsonb
)
`)
yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "project_directory" (
  "project_id" text NOT NULL,
  "directory" text NOT NULL,
  "type" text NOT NULL,
  "time_created" bigint NOT NULL,
  CONSTRAINT "project_directory_pk" PRIMARY KEY("project_id", "directory"),
  CONSTRAINT "fk_project_directory_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE
)
`)
yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "workspace_id" text,
  "parent_id" text,
  "slug" text NOT NULL,
  "directory" text NOT NULL,
  "path" text,
  "title" text NOT NULL,
  "version" text NOT NULL,
  "share_url" text,
  "summary_additions" integer,
  "summary_deletions" integer,
  "summary_files" integer,
  "summary_diffs" jsonb,
  "metadata" jsonb,
  "cost" double precision NOT NULL DEFAULT 0,
  "tokens_input" integer NOT NULL DEFAULT 0,
  "tokens_output" integer NOT NULL DEFAULT 0,
  "tokens_reasoning" integer NOT NULL DEFAULT 0,
  "tokens_cache_read" integer NOT NULL DEFAULT 0,
  "tokens_cache_write" integer NOT NULL DEFAULT 0,
  "revert" jsonb,
  "permission" jsonb,
  "agent" text,
  "model" jsonb,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL,
  "time_compacting" bigint,
  "time_archived" bigint,
  CONSTRAINT "fk_session_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE
)
`)
    yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "message" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL,
  "data" jsonb NOT NULL,
  CONSTRAINT "fk_message_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE
)
`)
    yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "part" (
  "id" text PRIMARY KEY,
  "message_id" text NOT NULL,
  "session_id" text NOT NULL,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL,
  "data" jsonb NOT NULL,
  CONSTRAINT "fk_part_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE
)
`)
    yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "permission" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "action" text NOT NULL,
  "resource" text NOT NULL,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL,
  CONSTRAINT "fk_permission_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE
)
`)
yield* db.run(sql`
CREATE UNIQUE INDEX IF NOT EXISTS "permission_project_action_resource_idx" ON "permission" ("project_id", "action", "resource")
`)
    yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "todo" (
  "session_id" text NOT NULL,
  "content" text NOT NULL,
  "status" text NOT NULL,
  "priority" text NOT NULL,
  "position" integer NOT NULL,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL,
  CONSTRAINT "todo_pk" PRIMARY KEY("session_id", "position"),
  CONSTRAINT "fk_todo_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE
)
`)
    yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "session_share" (
  "session_id" text PRIMARY KEY,
  "id" text NOT NULL,
  "secret" text NOT NULL,
  "url" text NOT NULL,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL,
  CONSTRAINT "fk_session_share_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE
)
`)
    yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "session_message" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL,
  "type" text NOT NULL,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL,
  "data" jsonb NOT NULL,
  CONSTRAINT "fk_session_message_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE
)
`)
    yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY,
  "email" text NOT NULL,
  "url" text NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "token_expiry" bigint,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL
)
`)
    yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "account_state" (
  "id" integer PRIMARY KEY NOT NULL,
  "active_account_id" text,
  "active_org_id" text,
  FOREIGN KEY ("active_account_id") REFERENCES "account"("id") ON UPDATE NO ACTION ON DELETE SET NULL
)
`)
    yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "control_account" (
  "email" text NOT NULL,
  "url" text NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "token_expiry" bigint,
  "active" boolean NOT NULL DEFAULT false,
  "time_created" bigint NOT NULL,
  "time_updated" bigint NOT NULL,
  CONSTRAINT "control_account_pk" PRIMARY KEY("email", "url")
)
`)
    yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "workspace" (
  "id" text PRIMARY KEY,
  "type" text NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "branch" text,
  "directory" text,
  "extra" jsonb,
  "project_id" text NOT NULL,
  "time_used" bigint NOT NULL DEFAULT 0,
  CONSTRAINT "fk_workspace_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE
)
`)
    yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "event_sequence" (
  "aggregate_id" text PRIMARY KEY,
  "seq" integer NOT NULL,
  "owner_id" text
)
`)
    yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "event" (
  "id" text PRIMARY KEY,
  "aggregate_id" text NOT NULL,
  "seq" integer NOT NULL,
  "type" text NOT NULL,
  "data" jsonb NOT NULL,
  CONSTRAINT "fk_event_aggregate_id_event_sequence_aggregate_id_fk" FOREIGN KEY ("aggregate_id") REFERENCES "event_sequence"("aggregate_id") ON DELETE CASCADE
)
`)
    yield* db.run(sql`
CREATE TABLE IF NOT EXISTS "data_migration" (
  "name" text PRIMARY KEY,
  "time_completed" bigint NOT NULL
)
`)

    yield* db.run(sql`CREATE INDEX IF NOT EXISTS "message_session_time_created_id_idx" ON "message" ("session_id","time_created","id")`)
    yield* db.run(sql`CREATE INDEX IF NOT EXISTS "part_message_id_id_idx" ON "part" ("message_id","id")`)
    yield* db.run(sql`CREATE INDEX IF NOT EXISTS "part_session_idx" ON "part" ("session_id")`)
    yield* db.run(sql`CREATE INDEX IF NOT EXISTS "session_project_idx" ON "session" ("project_id")`)
    yield* db.run(sql`CREATE INDEX IF NOT EXISTS "session_workspace_idx" ON "session" ("workspace_id")`)
    yield* db.run(sql`CREATE INDEX IF NOT EXISTS "session_parent_idx" ON "session" ("parent_id")`)
    yield* db.run(sql`CREATE INDEX IF NOT EXISTS "todo_session_idx" ON "todo" ("session_id")`)
    yield* db.run(sql`CREATE INDEX IF NOT EXISTS "session_message_session_idx" ON "session_message" ("session_id")`)
    yield* db.run(sql`CREATE INDEX IF NOT EXISTS "session_message_session_type_idx" ON "session_message" ("session_id","type")`)
    yield* db.run(sql`CREATE INDEX IF NOT EXISTS "session_message_time_created_idx" ON "session_message" ("time_created")`)
  })
}
