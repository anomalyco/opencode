CREATE TABLE `knowledge_entry` (
	`id` text PRIMARY KEY,
	`type` text NOT NULL,
	`session_id` text,
	`agent` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`content` text NOT NULL,
	`tags` text NOT NULL,
	`tag_weights` text,
	`category` text,
	`confidence` integer,
	`first_attempt_failed` integer,
	`impact` text,
	`related_files` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_knowledge_entry_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `knowledge_search_index` (
	`entry_id` text PRIMARY KEY,
	`tag_vector` text NOT NULL,
	`title_text` text NOT NULL,
	`description_text` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_knowledge_search_index_entry_id_knowledge_entry_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `knowledge_entry`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `knowledge_type_idx` ON `knowledge_entry` (`type`);--> statement-breakpoint
CREATE INDEX `knowledge_session_idx` ON `knowledge_entry` (`session_id`);--> statement-breakpoint
CREATE INDEX `knowledge_agent_idx` ON `knowledge_entry` (`agent`);--> statement-breakpoint
CREATE INDEX `knowledge_created_idx` ON `knowledge_entry` (`time_created`);--> statement-breakpoint
CREATE INDEX `knowledge_fts_idx` ON `knowledge_search_index` (`tag_vector`,`title_text`);