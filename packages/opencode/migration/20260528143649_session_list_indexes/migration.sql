CREATE INDEX `session_project_parent_time_idx` ON `session` (`project_id`,`parent_id`,`time_updated`,`id`);--> statement-breakpoint
CREATE INDEX `session_project_directory_parent_time_idx` ON `session` (`project_id`,`directory`,`parent_id`,`time_updated`,`id`);--> statement-breakpoint
CREATE INDEX `session_project_path_parent_time_idx` ON `session` (`project_id`,`path`,`parent_id`,`time_updated`,`id`);--> statement-breakpoint
CREATE INDEX `session_workspace_parent_time_idx` ON `session` (`workspace_id`,`parent_id`,`time_updated`,`id`);