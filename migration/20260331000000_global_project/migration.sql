-- Athena Browser Agent: consolidate all sessions under a single global project.
-- No git-based project discovery needed — all sessions share one project.

-- Ensure the global project row exists
INSERT OR IGNORE INTO project (id, worktree, time_created, time_updated, sandboxes)
VALUES ('global', '/', CAST(strftime('%s','now') * 1000 AS INTEGER), CAST(strftime('%s','now') * 1000 AS INTEGER), '[]');
--> statement-breakpoint

-- Reassign all sessions to the global project
UPDATE session SET project_id = 'global' WHERE project_id != 'global';
--> statement-breakpoint

-- Reassign all permissions to the global project
UPDATE permission SET project_id = 'global' WHERE project_id != 'global';
--> statement-breakpoint

-- Reassign all workspaces to the global project
UPDATE workspace SET project_id = 'global' WHERE project_id != 'global';
--> statement-breakpoint

-- Clean up old project rows (keep only global)
DELETE FROM project WHERE id != 'global';
