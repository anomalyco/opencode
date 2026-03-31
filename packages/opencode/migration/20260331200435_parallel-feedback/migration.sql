CREATE TABLE `parallel_metrics` (
	`plan_id` text PRIMARY KEY,
	`spawn_attempts` integer DEFAULT 0 NOT NULL,
	`spawn_success` integer DEFAULT 0 NOT NULL,
	`spawn_failure` integer DEFAULT 0 NOT NULL,
	`timeout_count` integer DEFAULT 0 NOT NULL,
	`plan_outcome` text,
	`total_input_tokens` integer DEFAULT 0 NOT NULL,
	`total_output_tokens` integer DEFAULT 0 NOT NULL,
	`orchestrator_calls` integer DEFAULT 0 NOT NULL,
	`worker_count` integer DEFAULT 0 NOT NULL,
	`merge_calls` integer DEFAULT 0 NOT NULL,
	`total_duration_ms` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_parallel_metrics_plan_id_plan_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plan`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `plan` ADD `shared_contracts` text;--> statement-breakpoint
ALTER TABLE `plan` ADD `conventions` text;--> statement-breakpoint
ALTER TABLE `plan` ADD `feedback` text;--> statement-breakpoint
ALTER TABLE `plan` ADD `integration_branch` text;--> statement-breakpoint
ALTER TABLE `plan` ADD `publish_mode` text;--> statement-breakpoint
ALTER TABLE `plan` ADD `approval_mode` text;--> statement-breakpoint
ALTER TABLE `plan` ADD `execution_mode` text;--> statement-breakpoint
CREATE INDEX `parallel_metrics_outcome_idx` ON `parallel_metrics` (`plan_outcome`);