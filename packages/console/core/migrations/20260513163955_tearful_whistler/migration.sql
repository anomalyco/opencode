CREATE TABLE `model_sticky_provider` (
	`id` varchar(255) PRIMARY KEY,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`provider_id` varchar(255) NOT NULL
);
