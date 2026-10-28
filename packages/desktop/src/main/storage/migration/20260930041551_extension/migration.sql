CREATE TABLE `extension` (
	`id` text PRIMARY KEY,
	`enabled` integer DEFAULT true NOT NULL,
	`manifest` text,
	`revision` text
);
--> statement-breakpoint
CREATE TABLE `extension_file` (
	`extension_id` text NOT NULL,
	`path` text NOT NULL,
	`data` blob NOT NULL,
	CONSTRAINT `extension_file_pk` PRIMARY KEY(`extension_id`, `path`)
);
