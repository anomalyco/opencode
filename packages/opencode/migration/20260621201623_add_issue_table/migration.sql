CREATE TABLE `issue` (
	`id` text PRIMARY KEY,
	`directory` text NOT NULL,
	`parent_id` text,
	`level` integer DEFAULT 0 NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'backlog' NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`due_date` text,
	`assignee_id` text,
	`linear_issue_id` text,
	`linear_team_id` text,
	`linear_project_id` text,
	`position` integer NOT NULL,
	`last_pushed_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_todo` (
	`session_id` text NOT NULL,
	`id` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`position` integer NOT NULL,
	`parent_id` text,
	`level` integer DEFAULT 0 NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`due_date` text,
	`team_id` text,
	`project_id` text,
	`assignee_id` text,
	`linear_issue_id` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `todo_pk` PRIMARY KEY(`session_id`, `id`),
	CONSTRAINT `fk_todo_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_todo`(`session_id`, `id`, `content`, `status`, `priority`, `position`, `time_created`, `time_updated`) SELECT `session_id`, lower(hex(randomblob(16))), `content`, `status`, `priority`, `position`, `time_created`, `time_updated` FROM `todo`;--> statement-breakpoint
DROP TABLE `todo`;--> statement-breakpoint
ALTER TABLE `__new_todo` RENAME TO `todo`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `todo_session_idx` ON `todo` (`session_id`);--> statement-breakpoint
CREATE INDEX `todo_parent_id_idx` ON `todo` (`parent_id`);--> statement-breakpoint
CREATE INDEX `issue_directory_idx` ON `issue` (`directory`);--> statement-breakpoint
CREATE INDEX `issue_parent_id_idx` ON `issue` (`parent_id`);--> statement-breakpoint
CREATE INDEX `issue_linear_issue_id_idx` ON `issue` (`linear_issue_id`);
