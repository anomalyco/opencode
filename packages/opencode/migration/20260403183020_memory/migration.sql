-- Memory fact table
CREATE TABLE `memory_fact` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text,
	`category` text NOT NULL,
	`subject` text NOT NULL,
	`value` text NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`source_hash` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_memory_fact_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `memory_fact_project_idx` ON `memory_fact` (`project_id`);
--> statement-breakpoint
CREATE INDEX `memory_fact_subject_idx` ON `memory_fact` (`project_id`,`subject`);
--> statement-breakpoint

-- Memory window table
CREATE TABLE `memory_window` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`goal` text NOT NULL,
	`instructions` text,
	`discoveries` text,
	`accomplished` text,
	`in_progress` text,
	`blocked_on` text,
	`files_touched` text NOT NULL,
	`relevant_dirs` text NOT NULL,
	`message_ids` text NOT NULL,
	`parent_window_id` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_memory_window_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `memory_window_session_idx` ON `memory_window` (`session_id`);
--> statement-breakpoint
CREATE INDEX `memory_window_project_time_idx` ON `memory_window` (`project_id`,`ended_at`);
--> statement-breakpoint

-- Memory artifact table
CREATE TABLE `memory_artifact` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`window_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`file_path` text,
	`metadata` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_memory_artifact_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_memory_artifact_window_id_memory_window_id_fk` FOREIGN KEY (`window_id`) REFERENCES `memory_window`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `memory_artifact_window_idx` ON `memory_artifact` (`window_id`);
--> statement-breakpoint
CREATE INDEX `memory_artifact_kind_idx` ON `memory_artifact` (`project_id`,`kind`);
--> statement-breakpoint

-- Memory project table
CREATE TABLE `memory_project` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`project_key` text NOT NULL,
	`project_name` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`summary` text NOT NULL,
	`latest_progress` text,
	`blockers` text,
	`source_window_ids` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_memory_project_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `memory_project_key_idx` ON `memory_project` (`project_id`,`project_key`);
--> statement-breakpoint

-- FTS5 virtual tables
CREATE VIRTUAL TABLE `memory_window_fts` USING fts5(id, goal, instructions, discoveries, accomplished, in_progress, content=memory_window, content_rowid=rowid);
--> statement-breakpoint
CREATE VIRTUAL TABLE `memory_fact_fts` USING fts5(id, subject, value, content=memory_fact, content_rowid=rowid);
--> statement-breakpoint
CREATE VIRTUAL TABLE `memory_artifact_fts` USING fts5(id, content, file_path, content=memory_artifact, content_rowid=rowid);
