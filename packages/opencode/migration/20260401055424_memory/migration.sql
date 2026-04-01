CREATE TABLE `memory` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`project_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`tags` text,
	`file` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_scope_idx` ON `memory` (`scope`);--> statement-breakpoint
CREATE INDEX `memory_project_idx` ON `memory` (`project_id`);--> statement-breakpoint
CREATE INDEX `memory_type_idx` ON `memory` (`type`);