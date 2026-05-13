ALTER TABLE "project" DROP COLUMN IF EXISTS "worktree";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN IF EXISTS "vcs";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN IF EXISTS "sandboxes";--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "directory" DROP NOT NULL;