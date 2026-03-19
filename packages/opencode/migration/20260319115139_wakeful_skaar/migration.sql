CREATE TABLE `plan` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text,
	`status` text NOT NULL,
	`task` text NOT NULL,
	`orchestrator_model` text NOT NULL,
	`worker_model` text NOT NULL,
	`subtasks` text NOT NULL,
	`workers` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`time_approved` integer,
	`time_completed` integer,
	CONSTRAINT `fk_plan_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_plan_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `plan_project_idx` ON `plan` (`project_id`);--> statement-breakpoint
CREATE INDEX `plan_session_idx` ON `plan` (`session_id`);--> statement-breakpoint
CREATE INDEX `plan_status_idx` ON `plan` (`status`);