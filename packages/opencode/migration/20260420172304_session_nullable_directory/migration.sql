ALTER TABLE "project" DROP COLUMN "worktree";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "vcs";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "sandboxes";--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "directory" DROP NOT NULL;