CREATE TABLE `team` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE `team_member` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` text NOT NULL,
	`session_id` text NOT NULL,
	`agent` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE `team_task` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`subject` text NOT NULL,
	`description` text,
	`owner` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`metadata` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE `agent_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent` text NOT NULL,
	`content` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `team_session_idx` ON `team` (`session_id`);--> statement-breakpoint
CREATE INDEX `team_member_team_idx` ON `team_member` (`team_id`);--> statement-breakpoint
CREATE INDEX `team_member_session_idx` ON `team_member` (`session_id`);--> statement-breakpoint
CREATE INDEX `team_task_team_idx` ON `team_task` (`team_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_memory_project_agent_idx` ON `agent_memory` (`project_id`,`agent`);