ALTER TABLE `session` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `session_workspace_idx` ON `session` (`workspace_id`);