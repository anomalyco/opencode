CREATE TABLE `monitor_alert_channel` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`url` text,
	`credentials` text DEFAULT '{}' NOT NULL,
	`secret` text,
	`enabled` integer DEFAULT true NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `monitor_alert_event` (
	`id` text PRIMARY KEY,
	`rule_id` text NOT NULL,
	`session_id` text,
	`payload` text NOT NULL,
	`status` text DEFAULT 'fired' NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`acked_at` integer,
	CONSTRAINT `fk_monitor_alert_event_rule_id_monitor_alert_rule_id_fk` FOREIGN KEY (`rule_id`) REFERENCES `monitor_alert_rule`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `monitor_alert_rule` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`condition` text NOT NULL,
	`cooldown_sec` integer DEFAULT 300 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `monitor_metric` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text,
	`kind` text NOT NULL,
	`value` real NOT NULL,
	`dimensions` text DEFAULT '{}' NOT NULL,
	`bucket` text NOT NULL,
	`bucket_start` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `monitor_alert_channel_project_idx` ON `monitor_alert_channel` (`project_id`);--> statement-breakpoint
CREATE INDEX `monitor_alert_channel_enabled_idx` ON `monitor_alert_channel` (`enabled`);--> statement-breakpoint
CREATE INDEX `monitor_alert_event_rule_idx` ON `monitor_alert_event` (`rule_id`);--> statement-breakpoint
CREATE INDEX `monitor_alert_event_session_idx` ON `monitor_alert_event` (`session_id`);--> statement-breakpoint
CREATE INDEX `monitor_alert_event_time_idx` ON `monitor_alert_event` (`time_created`);--> statement-breakpoint
CREATE INDEX `monitor_alert_rule_project_idx` ON `monitor_alert_rule` (`project_id`);--> statement-breakpoint
CREATE INDEX `monitor_alert_rule_enabled_idx` ON `monitor_alert_rule` (`enabled`);--> statement-breakpoint
CREATE INDEX `monitor_metric_project_kind_idx` ON `monitor_metric` (`project_id`,`kind`);--> statement-breakpoint
CREATE INDEX `monitor_metric_session_idx` ON `monitor_metric` (`session_id`);--> statement-breakpoint
CREATE INDEX `monitor_metric_bucket_idx` ON `monitor_metric` (`bucket`,`bucket_start`);