-- docID is a per-input property (where the prompt was authored), so it lives only on
-- prompt_cycle_input. Drop the redundant cycle-level doc_id column and its index.
-- Recreate prompt_cycle without doc_id (recreate the input child alongside it because of the FK).
DROP TABLE IF EXISTS `prompt_cycle_input`;--> statement-breakpoint
DROP TABLE IF EXISTS `prompt_cycle`;--> statement-breakpoint
CREATE TABLE `prompt_cycle` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`time_created` integer NOT NULL,
	`assistant_message_id` text NOT NULL,
	`response` text,
	`model_id` text,
	`provider_id` text,
	`time_output_start` integer,
	`time_completed` integer,
	`ttft_ms` integer,
	`tokens_input` integer,
	`tokens_output` integer,
	`tokens_reasoning` integer,
	`tokens_cache_read` integer,
	`tokens_cache_write` integer,
	`cost_input` real,
	`cost_output` real,
	`cost_total` real,
	`status` text DEFAULT 'running' NOT NULL,
	`aborted` integer DEFAULT false NOT NULL,
	`error` text,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prompt_cycle_session_idx` ON `prompt_cycle` (`session_id`);--> statement-breakpoint
CREATE INDEX `prompt_cycle_status_idx` ON `prompt_cycle` (`status`);--> statement-breakpoint
CREATE INDEX `prompt_cycle_created_idx` ON `prompt_cycle` (`time_created`);--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_cycle_assistant_unique` ON `prompt_cycle` (`assistant_message_id`);--> statement-breakpoint
CREATE TABLE `prompt_cycle_input` (
	`id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`session_id` text NOT NULL,
	`doc_id` text,
	`submit_id` text,
	`actor_id` text,
	`seq` integer DEFAULT 0 NOT NULL,
	`prompt` text NOT NULL,
	`assets` text,
	`actor_count` integer DEFAULT 1 NOT NULL,
	`user_message_id` text,
	`time_created` integer NOT NULL,
	`time_consented` integer,
	`consent_ms` integer,
	PRIMARY KEY(`cycle_id`, `id`),
	FOREIGN KEY (`cycle_id`) REFERENCES `prompt_cycle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prompt_cycle_input_cycle_idx` ON `prompt_cycle_input` (`cycle_id`);--> statement-breakpoint
CREATE INDEX `prompt_cycle_input_session_idx` ON `prompt_cycle_input` (`session_id`);
