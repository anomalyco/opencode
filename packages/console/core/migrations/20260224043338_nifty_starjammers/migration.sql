CREATE TABLE `lite` (
	`id` varchar(30) NOT NULL,
	`workspace_id` varchar(30) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`user_id` varchar(30) NOT NULL,
	`rolling_usage` bigint,
	`weekly_usage` bigint,
	`monthly_usage` bigint,
	`time_rolling_updated` timestamp(3),
	`time_weekly_updated` timestamp(3),
	`time_monthly_updated` timestamp(3),
	CONSTRAINT `PRIMARY` PRIMARY KEY(`workspace_id`,`id`),
	CONSTRAINT `workspace_user_id` UNIQUE INDEX(`workspace_id`,`user_id`)
);
--> statement-breakpoint
ALTER TABLE `billing` ADD `lite_subscription_id` varchar(28);--> statement-breakpoint
ALTER TABLE `billing` ADD `lite` json;