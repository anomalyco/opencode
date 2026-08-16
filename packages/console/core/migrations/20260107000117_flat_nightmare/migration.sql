ALTER TABLE `billing` ADD `subscription_id` varchar(28);--> statement-breakpoint
ALTER TABLE `usage` ADD `data` json;--> statement-breakpoint
ALTER TABLE `user` ADD `time_subscribed` timestamp(3);--> statement-breakpoint
ALTER TABLE `user` ADD `sub_recent_usage` bigint;--> statement-breakpoint
ALTER TABLE `user` ADD `sub_monthly_usage` bigint;--> statement-breakpoint
ALTER TABLE `user` ADD `sub_time_recent_usage_updated` timestamp(3);--> statement-breakpoint
ALTER TABLE `user` ADD `sub_time_monthly_usage_updated` timestamp(3);