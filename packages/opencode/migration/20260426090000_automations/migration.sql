CREATE TABLE `automation` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`enabled` integer NOT NULL,
	`kind` text NOT NULL,
	`thread_id` text,
	`prompt` text NOT NULL,
	`schedule` text NOT NULL,
	`execution_mode` text NOT NULL,
	`model` text NOT NULL,
	`reasoning_effort` text,
	`permission_profile` text NOT NULL,
	`notification_behavior` text NOT NULL,
	`max_runtime_minutes` integer,
	`starts_at` integer,
	`ends_at` integer,
	`last_run_at` integer,
	`next_run_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_automation_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_automation_thread_id_session_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `automation_project_idx` ON `automation` (`project_id`);--> statement-breakpoint
CREATE INDEX `automation_due_idx` ON `automation` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `automation_run` (
	`id` text PRIMARY KEY,
	`automation_id` text NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text,
	`status` text NOT NULL,
	`prompt_snapshot` text NOT NULL,
	`model_snapshot` text NOT NULL,
	`execution_mode_snapshot` text NOT NULL,
	`schedule_snapshot` text NOT NULL,
	`worktree_path` text,
	`branch_name` text,
	`summary` text,
	`result` text,
	`findings_count` integer NOT NULL,
	`diff_additions` integer,
	`diff_deletions` integer,
	`diff_files` integer,
	`error` text,
	`time_queued` integer NOT NULL,
	`time_started` integer,
	`time_completed` integer,
	`time_read` integer,
	`time_archived` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_automation_run_automation_id_automation_id_fk` FOREIGN KEY (`automation_id`) REFERENCES `automation`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_automation_run_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_automation_run_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `automation_run_automation_idx` ON `automation_run` (`automation_id`);--> statement-breakpoint
CREATE INDEX `automation_run_project_status_idx` ON `automation_run` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `automation_run_project_time_idx` ON `automation_run` (`project_id`,`time_created`);--> statement-breakpoint
CREATE TABLE `automation_finding` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`title` text NOT NULL,
	`severity` text NOT NULL,
	`details` text NOT NULL,
	`files_changed` text NOT NULL,
	`recommended_next_action` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_automation_finding_run_id_automation_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `automation_run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `automation_finding_run_idx` ON `automation_finding` (`run_id`);
