CREATE INDEX `session_directory_time_idx` ON `session` (`directory`,`time_created`,`id`);--> statement-breakpoint
CREATE INDEX `session_workspace_time_idx` ON `session` (`workspace_id`,`time_created`,`id`);--> statement-breakpoint
CREATE INDEX `session_project_time_idx` ON `session` (`project_id`,`time_created`,`id`);