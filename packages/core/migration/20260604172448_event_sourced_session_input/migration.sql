DELETE FROM `session_input`;--> statement-breakpoint
DELETE FROM `session_message`;--> statement-breakpoint
DELETE FROM `event`;--> statement-breakpoint
DELETE FROM `event_sequence`;--> statement-breakpoint
UPDATE `session` SET `workspace_id` = NULL;--> statement-breakpoint
DELETE FROM `workspace`;--> statement-breakpoint
DROP INDEX IF EXISTS `event_aggregate_seq_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `event_aggregate_seq_idx` ON `event` (`aggregate_id`,`seq`);--> statement-breakpoint
DROP INDEX IF EXISTS `session_message_session_seq_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `session_message_session_seq_idx` ON `session_message` (`session_id`,`seq`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session_input` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`prompt` text NOT NULL,
	`delivery` text NOT NULL,
	`admitted_seq` integer NOT NULL,
	`promoted_seq` integer,
	`time_created` integer NOT NULL,
	CONSTRAINT `fk_session_input_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
DROP TABLE `session_input`;--> statement-breakpoint
ALTER TABLE `__new_session_input` RENAME TO `session_input`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `session_input_session_pending_delivery_seq_idx` ON `session_input` (`session_id`,`promoted_seq`,`delivery`,`admitted_seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_input_session_admitted_seq_idx` ON `session_input` (`session_id`,`admitted_seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_input_session_promoted_seq_idx` ON `session_input` (`session_id`,`promoted_seq`);
