CREATE TABLE `subscription` (
	`id` varchar(30) NOT NULL,
	`workspace_id` varchar(30) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`user_id` varchar(30) NOT NULL,
	`rolling_usage` bigint,
	`fixed_usage` bigint,
	`time_rolling_updated` timestamp(3),
	`time_fixed_updated` timestamp(3),
	CONSTRAINT `subscription_workspace_id_id_pk` PRIMARY KEY(`workspace_id`,`id`)
);
