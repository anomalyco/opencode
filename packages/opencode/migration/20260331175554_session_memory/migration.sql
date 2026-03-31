CREATE TABLE `memory_api_key` (
	`id` text PRIMARY KEY,
	`provider` text NOT NULL,
	`key_name` text NOT NULL,
	`encrypted_value` text NOT NULL,
	`description` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_preference` (
	`id` text PRIMARY KEY,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`type` text NOT NULL,
	`description` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_rule` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`pattern` text NOT NULL,
	`rule` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_memory_rule_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `memory_api_key_provider_idx` ON `memory_api_key` (`provider`);--> statement-breakpoint
CREATE INDEX `memory_api_key_name_idx` ON `memory_api_key` (`key_name`);--> statement-breakpoint
CREATE INDEX `memory_preference_key_idx` ON `memory_preference` (`key`);--> statement-breakpoint
CREATE INDEX `memory_rule_project_idx` ON `memory_rule` (`project_id`);--> statement-breakpoint
CREATE INDEX `memory_rule_pattern_idx` ON `memory_rule` (`pattern`);