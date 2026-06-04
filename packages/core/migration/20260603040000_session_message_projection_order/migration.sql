DELETE FROM `session_message`;--> statement-breakpoint
ALTER TABLE `session_message` ADD `seq` integer NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `session_message_session_time_created_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `session_message_session_type_time_created_id_idx`;--> statement-breakpoint
CREATE INDEX `session_message_session_seq_idx` ON `session_message` (`session_id`,`seq`);--> statement-breakpoint
CREATE INDEX `session_message_session_type_seq_idx` ON `session_message` (`session_id`,`type`,`seq`);
