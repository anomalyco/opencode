CREATE TABLE `doc` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `doc_update` (
	`id` text PRIMARY KEY,
	`doc_id` text NOT NULL,
	`data` blob NOT NULL,
	`time_created` integer NOT NULL,
	CONSTRAINT `fk_doc_update_doc_id_doc_id_fk` FOREIGN KEY (`doc_id`) REFERENCES `doc`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session_actor` (
	`session_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_seen` integer NOT NULL,
	CONSTRAINT `session_actor_pk` PRIMARY KEY(`session_id`, `actor_id`),
	CONSTRAINT `fk_session_actor_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session_prompt_doc` (
	`session_id` text PRIMARY KEY,
	`doc_id` text NOT NULL,
	CONSTRAINT `fk_session_prompt_doc_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_prompt_doc_doc_id_doc_id_fk` FOREIGN KEY (`doc_id`) REFERENCES `doc`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `doc_update_doc_idx` ON `doc_update` (`doc_id`);--> statement-breakpoint
CREATE INDEX `session_actor_session_idx` ON `session_actor` (`session_id`);