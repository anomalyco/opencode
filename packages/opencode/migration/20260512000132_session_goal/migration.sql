CREATE TABLE `session_goal` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`objective` text NOT NULL,
	`status` text NOT NULL,
	`token_budget` integer,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	`time_used` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_session_goal_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_goal_session_idx` ON `session_goal` (`session_id`);--> statement-breakpoint
CREATE INDEX `session_goal_status_idx` ON `session_goal` (`status`);