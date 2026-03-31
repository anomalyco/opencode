CREATE TABLE `memory` (
	`id` text PRIMARY KEY NOT NULL,
	`project_path` text NOT NULL,
	`type` text NOT NULL,
	`topic` text NOT NULL,
	`content` text NOT NULL,
	`session_id` text,
	`access_count` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_project_topic_idx` ON `memory` (`project_path`, `topic`);
--> statement-breakpoint
CREATE INDEX `memory_project_idx` ON `memory` (`project_path`);
--> statement-breakpoint
CREATE INDEX `memory_type_idx` ON `memory` (`type`);
