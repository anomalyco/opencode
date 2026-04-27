ALTER TABLE `session` ADD `multi_root_workspace_id` text;--> statement-breakpoint
CREATE INDEX `session_multi_root_workspace_idx` ON `session` (`multi_root_workspace_id`);