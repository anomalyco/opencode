CREATE TABLE `dead_letter` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`session_id` text NOT NULL,
	`error` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`last_attempt` integer NOT NULL,
	`time_created` integer NOT NULL,
	CONSTRAINT `fk_dead_letter_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `state_snapshot` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`graph_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`completed_nodes` text,
	`in_progress_nodes` text,
	`failed_nodes` text,
	`metadata` text,
	`time_created` integer NOT NULL,
	CONSTRAINT `fk_state_snapshot_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `task_dependency` (
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	CONSTRAINT `fk_task_dependency_source_id_task_node_id_fk` FOREIGN KEY (`source_id`) REFERENCES `task_node`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_task_dependency_target_id_task_node_id_fk` FOREIGN KEY (`target_id`) REFERENCES `task_node`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `task_metrics` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`task_id` text NOT NULL,
	`duration` integer NOT NULL,
	`tokens_used` integer NOT NULL,
	`attempts` integer NOT NULL,
	`success` integer NOT NULL,
	`complexity` text NOT NULL,
	`skills_used` text,
	`type` text NOT NULL,
	`time_created` integer NOT NULL,
	CONSTRAINT `fk_task_metrics_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_task_metrics_task_id_task_node_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task_node`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `task_node` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`version` integer NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`duration` integer,
	`tokens_used` integer,
	`result` text,
	`data` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_task_node_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `dead_letter_session_idx` ON `dead_letter` (`session_id`);--> statement-breakpoint
CREATE INDEX `dead_letter_task_idx` ON `dead_letter` (`task_id`);--> statement-breakpoint
CREATE INDEX `state_snapshot_session_idx` ON `state_snapshot` (`session_id`);--> statement-breakpoint
CREATE INDEX `state_snapshot_graph_idx` ON `state_snapshot` (`graph_id`);--> statement-breakpoint
CREATE INDEX `state_snapshot_timestamp_idx` ON `state_snapshot` (`timestamp`);--> statement-breakpoint
CREATE INDEX `task_dependency_source_idx` ON `task_dependency` (`source_id`);--> statement-breakpoint
CREATE INDEX `task_dependency_target_idx` ON `task_dependency` (`target_id`);--> statement-breakpoint
CREATE INDEX `task_metrics_session_idx` ON `task_metrics` (`session_id`);--> statement-breakpoint
CREATE INDEX `task_metrics_task_idx` ON `task_metrics` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_metrics_type_idx` ON `task_metrics` (`type`);--> statement-breakpoint
CREATE INDEX `task_node_session_idx` ON `task_node` (`session_id`);--> statement-breakpoint
CREATE INDEX `task_node_status_idx` ON `task_node` (`status`);--> statement-breakpoint
CREATE INDEX `task_node_type_idx` ON `task_node` (`type`);