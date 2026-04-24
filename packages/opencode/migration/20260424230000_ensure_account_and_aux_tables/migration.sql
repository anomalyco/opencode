-- Production (and any DB) may have been migrated manually without running the
-- full bootstrap; create missing tables the app expects. IF NOT EXISTS is safe
-- when tables already exist from a full bootstrap.

CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY,
	"email" text NOT NULL,
	"url" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expiry" bigint,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_state" (
	"id" integer PRIMARY KEY,
	"active_account_id" text,
	"active_org_id" text
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control_account" (
	"email" text,
	"url" text,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expiry" bigint,
	"active" integer NOT NULL,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL,
	CONSTRAINT "control_account_pkey" PRIMARY KEY("email","url")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permission" (
	"project_id" text PRIMARY KEY,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL,
	"data" jsonb NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session_share" (
	"session_id" text PRIMARY KEY,
	"id" text NOT NULL,
	"secret" text NOT NULL,
	"url" text NOT NULL,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "todo" (
	"session_id" text NOT NULL,
	"content" text NOT NULL,
	"status" text NOT NULL,
	"priority" text NOT NULL,
	"position" bigint NOT NULL,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL,
	CONSTRAINT "todo_pkey" PRIMARY KEY("session_id","position")
);--> statement-breakpoint
DO $do$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'account_state_active_account_id_account_id_fkey'
	) THEN
		ALTER TABLE "account_state"
			ADD CONSTRAINT "account_state_active_account_id_account_id_fkey"
			FOREIGN KEY ("active_account_id") REFERENCES "account"("id") ON DELETE SET NULL;
	END IF;
EXCEPTION
	WHEN undefined_table THEN NULL;
	WHEN duplicate_object THEN NULL;
END
$do$;--> statement-breakpoint
DO $do$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'permission_project_id_project_id_fkey') THEN
		ALTER TABLE "permission"
			ADD CONSTRAINT "permission_project_id_project_id_fkey"
			FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;
	END IF;
EXCEPTION
	WHEN undefined_table THEN NULL;
	WHEN duplicate_object THEN NULL;
END
$do$;--> statement-breakpoint
DO $do$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_share_session_id_session_id_fkey') THEN
		ALTER TABLE "session_share"
			ADD CONSTRAINT "session_share_session_id_session_id_fkey"
			FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE;
	END IF;
EXCEPTION
	WHEN undefined_table THEN NULL;
	WHEN duplicate_object THEN NULL;
END
$do$;--> statement-breakpoint
DO $do$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todo_session_id_session_id_fkey') THEN
		ALTER TABLE "todo"
			ADD CONSTRAINT "todo_session_id_session_id_fkey"
			FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE;
	END IF;
EXCEPTION
	WHEN undefined_table THEN NULL;
	WHEN duplicate_object THEN NULL;
END
$do$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todo_session_idx" ON "todo" ("session_id");