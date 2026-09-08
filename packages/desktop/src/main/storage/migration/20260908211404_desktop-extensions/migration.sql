CREATE TABLE `desktop_extension_file` (
	`extension_id` text NOT NULL,
	`path` text NOT NULL,
	`data` blob NOT NULL,
	CONSTRAINT `desktop_extension_file_pk` PRIMARY KEY(`extension_id`, `path`)
);
--> statement-breakpoint
CREATE TABLE `desktop_extension` (
	`id` text PRIMARY KEY,
	`manifest` text NOT NULL,
	`revision` text NOT NULL,
	`generation` integer NOT NULL,
	`enabled` integer NOT NULL
);
