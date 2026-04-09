DROP INDEX IF EXISTS `message_session_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `part_message_idx`;--> statement-breakpoint
CREATE INDEX `message_session_time_created_id_idx` ON `message` (`session_id`,`time_created`,`id`);--> statement-breakpoint
CREATE INDEX `part_message_id_id_idx` ON `part` (`message_id`,`id`);