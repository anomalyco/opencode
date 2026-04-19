ALTER TABLE `push_subscription` ADD `server_origin` text NOT NULL;--> statement-breakpoint
ALTER TABLE `push_subscription` ADD `device_label` text;--> statement-breakpoint
ALTER TABLE `push_subscription` ADD `failure_count` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `push_subscription` ADD `last_success_at` integer;--> statement-breakpoint
ALTER TABLE `push_subscription` ADD `last_failure_at` integer;