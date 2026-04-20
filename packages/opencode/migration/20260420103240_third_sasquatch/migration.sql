CREATE TABLE "account_state" (
	"id" integer PRIMARY KEY,
	"active_account_id" text,
	"active_org_id" text
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"email" text NOT NULL,
	"url" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expiry" bigint,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_account" (
	"email" text,
	"url" text,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expiry" bigint,
	"active" integer NOT NULL,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL,
	CONSTRAINT "control_account_pkey" PRIMARY KEY("email","url")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "part" (
	"id" text PRIMARY KEY,
	"message_id" text NOT NULL,
	"session_id" text NOT NULL,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission" (
	"project_id" text PRIMARY KEY,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY,
	"tenant_user_id" text NOT NULL,
	"worktree" text NOT NULL,
	"vcs" text,
	"name" text,
	"icon_url" text,
	"icon_color" text,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL,
	"time_initialized" bigint,
	"sandboxes" jsonb DEFAULT '[]' NOT NULL,
	"commands" jsonb
);
--> statement-breakpoint
CREATE TABLE "session_share" (
	"session_id" text PRIMARY KEY,
	"id" text NOT NULL,
	"secret" text NOT NULL,
	"url" text NOT NULL,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"workspace_id" text,
	"parent_id" text,
	"slug" text NOT NULL,
	"directory" text NOT NULL,
	"title" text NOT NULL,
	"version" text NOT NULL,
	"share_url" text,
	"summary_additions" integer,
	"summary_deletions" integer,
	"summary_files" integer,
	"summary_diffs" jsonb,
	"revert" jsonb,
	"permission" jsonb,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL,
	"time_compacting" bigint,
	"time_archived" bigint
);
--> statement-breakpoint
CREATE TABLE "todo" (
	"session_id" text,
	"content" text NOT NULL,
	"status" text NOT NULL,
	"priority" text NOT NULL,
	"position" bigint,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL,
	CONSTRAINT "todo_pkey" PRIMARY KEY("session_id","position")
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY,
	"branch" text,
	"project_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text,
	"directory" text,
	"extra" jsonb
);
--> statement-breakpoint
CREATE INDEX "message_session_idx" ON "message" ("session_id");--> statement-breakpoint
CREATE INDEX "part_message_idx" ON "part" ("message_id");--> statement-breakpoint
CREATE INDEX "part_session_idx" ON "part" ("session_id");--> statement-breakpoint
CREATE INDEX "session_project_idx" ON "session" ("project_id");--> statement-breakpoint
CREATE INDEX "session_workspace_idx" ON "session" ("workspace_id");--> statement-breakpoint
CREATE INDEX "session_parent_idx" ON "session" ("parent_id");--> statement-breakpoint
CREATE INDEX "todo_session_idx" ON "todo" ("session_id");--> statement-breakpoint
CREATE INDEX "workspace_project_idx" ON "workspace" ("project_id");--> statement-breakpoint
ALTER TABLE "account_state" ADD CONSTRAINT "account_state_active_account_id_account_id_fkey" FOREIGN KEY ("active_account_id") REFERENCES "account"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "part" ADD CONSTRAINT "part_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "permission" ADD CONSTRAINT "permission_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session_share" ADD CONSTRAINT "session_share_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "todo" ADD CONSTRAINT "todo_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;