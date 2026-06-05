DROP INDEX IF EXISTS `session_message_session_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `session_message_session_type_idx`;--> statement-breakpoint
CREATE INDEX `event_aggregate_seq_idx` ON `event` (`aggregate_id`,`seq`);--> statement-breakpoint
CREATE INDEX `session_message_session_time_created_id_idx` ON `session_message` (`session_id`,`time_created`,`id`);--> statement-breakpoint
CREATE INDEX `session_message_session_type_time_created_id_idx` ON `session_message` (`session_id`,`type`,`time_created`,`id`);