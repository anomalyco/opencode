PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`workspace_id` text,
	`parent_id` text,
	`kind` text DEFAULT 'default' NOT NULL,
	`slug` text NOT NULL,
	`directory` text NOT NULL,
	`title` text NOT NULL,
	`version` text NOT NULL,
	`share_url` text,
	`summary_additions` integer,
	`summary_deletions` integer,
	`summary_files` integer,
	`summary_diffs` text,
	`revert` text,
	`permission` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`time_compacting` integer,
	`time_archived` integer,
	CONSTRAINT `fk_session_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT "session_sidekick_parent_chk" CHECK(kind <> 'sidekick' OR parent_id IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_session`(`id`, `project_id`, `workspace_id`, `parent_id`, `kind`, `slug`, `directory`, `title`, `version`, `share_url`, `summary_additions`, `summary_deletions`, `summary_files`, `summary_diffs`, `revert`, `permission`, `time_created`, `time_updated`, `time_compacting`, `time_archived`) SELECT `id`, `project_id`, `workspace_id`, `parent_id`, `kind`, `slug`, `directory`, `title`, `version`, `share_url`, `summary_additions`, `summary_deletions`, `summary_files`, `summary_diffs`, `revert`, `permission`, `time_created`, `time_updated`, `time_compacting`, `time_archived` FROM `session`;--> statement-breakpoint
DROP TABLE `session`;--> statement-breakpoint
ALTER TABLE `__new_session` RENAME TO `session`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `session_project_idx` ON `session` (`project_id`);--> statement-breakpoint
CREATE INDEX `session_workspace_idx` ON `session` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `session_parent_idx` ON `session` (`parent_id`);--> statement-breakpoint
CREATE INDEX `session_kind_idx` ON `session` (`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_parent_kind_uniq` ON `session` (`parent_id`,`kind`) WHERE kind = 'sidekick';