ALTER TABLE "project" ALTER COLUMN "tenant_user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "worktree";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "vcs";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "sandboxes";
