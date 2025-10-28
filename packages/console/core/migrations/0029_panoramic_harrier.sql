ALTER TABLE `user` ADD `monthly_limit` int;--> statement-breakpoint
ALTER TABLE `user` ADD `monthly_usage` bigint;--> statement-breakpoint
ALTER TABLE `user` ADD `time_monthly_usage_updated` timestamp(3);