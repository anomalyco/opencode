CREATE TABLE `doc_submit` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`doc_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`status` text NOT NULL,
	`prompt` text NOT NULL,
	`timeout_ms` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`cancelled_by` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_doc_submit_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_doc_submit_doc_id_doc_id_fk` FOREIGN KEY (`doc_id`) REFERENCES `doc`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `doc_submit_actor` (
	`submit_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`time_responded` integer,
	CONSTRAINT `doc_submit_actor_pk` PRIMARY KEY(`submit_id`,`actor_id`),
	CONSTRAINT `fk_doc_submit_actor_submit_id_doc_submit_id_fk` FOREIGN KEY (`submit_id`) REFERENCES `doc_submit`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `doc_submit_session_doc_status_idx` ON `doc_submit` (`session_id`,`doc_id`,`status`);--> statement-breakpoint
CREATE INDEX `doc_submit_expires_idx` ON `doc_submit` (`expires_at`);--> statement-breakpoint
CREATE INDEX `doc_submit_actor_actor_idx` ON `doc_submit_actor` (`actor_id`);
