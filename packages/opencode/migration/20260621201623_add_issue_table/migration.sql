CREATE TABLE `issue` (
	`id` text PRIMARY KEY,
	`directory` text NOT NULL,
	`parent_id` text,
	`level` integer DEFAULT 0 NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Backlog' NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`due_date` text,
	`assignee_id` text,
	`linear_issue_id` text,
	`linear_team_id` text,
	`linear_project_id` text,
	`position` integer NOT NULL,
	`last_pushed_at` integer,
	`last_pulled_at` integer,
	`cloud_shadow` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `issue_directory_idx` ON `issue` (`directory`);
--> statement-breakpoint
CREATE INDEX `issue_parent_id_idx` ON `issue` (`parent_id`);
--> statement-breakpoint
CREATE INDEX `issue_linear_issue_id_idx` ON `issue` (`linear_issue_id`);
