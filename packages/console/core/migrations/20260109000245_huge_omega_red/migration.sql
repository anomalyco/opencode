CREATE INDEX `workspace_user_id` ON `subscription` (`workspace_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `user` DROP COLUMN `time_subscribed`;--> statement-breakpoint
ALTER TABLE `user` DROP COLUMN `sub_interval_usage`;--> statement-breakpoint
ALTER TABLE `user` DROP COLUMN `sub_monthly_usage`;--> statement-breakpoint
ALTER TABLE `user` DROP COLUMN `sub_time_interval_usage_updated`;--> statement-breakpoint
ALTER TABLE `user` DROP COLUMN `sub_time_monthly_usage_updated`;