CREATE TABLE `provider` (
	`id` varchar(30) NOT NULL,
	`workspace_id` varchar(30) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`provider` varchar(64) NOT NULL,
	`credentials` text NOT NULL,
	CONSTRAINT `provider_workspace_id_id_pk` PRIMARY KEY(`workspace_id`,`id`),
	CONSTRAINT `workspace_provider` UNIQUE(`workspace_id`,`provider`)
);
