-- actorIDs as an array on the input (solo=[self], multi-consent=[a,b,...], normal=null),
-- and a user_message_id link on doc_submit so a recorded cycle can resolve its submit/actors.
ALTER TABLE `doc_submit` ADD `user_message_id` text;--> statement-breakpoint
DROP TABLE IF EXISTS `prompt_cycle_input`;--> statement-breakpoint
CREATE TABLE `prompt_cycle_input` (
	`id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`session_id` text NOT NULL,
	`doc_id` text,
	`submit_id` text,
	`actor_ids` text,
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
