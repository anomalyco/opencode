ALTER TABLE `billing` ADD `monthly_limit` int;--> statement-breakpoint
ALTER TABLE `billing` ADD `monthly_usage` bigint;--> statement-breakpoint
ALTER TABLE `billing` ADD `time_monthly_usage_updated` timestamp(3);