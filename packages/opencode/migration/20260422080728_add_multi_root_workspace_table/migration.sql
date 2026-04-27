CREATE TABLE `multi_root_workspace` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`file_path` text NOT NULL,
	`folders` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `multi_root_workspace_name_idx` ON `multi_root_workspace` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `multi_root_workspace_file_path_idx` ON `multi_root_workspace` (`file_path`);
