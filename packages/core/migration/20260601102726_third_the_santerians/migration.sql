CREATE TABLE `metrics` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`tokens_input` integer DEFAULT 0 NOT NULL,
	`tokens_output` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	CONSTRAINT `fk_metrics_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `metrics_session_idx` ON `metrics` (`session_id`);