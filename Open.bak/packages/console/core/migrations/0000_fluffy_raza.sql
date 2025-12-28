CREATE TABLE `account` (
	`id` varchar(30) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`email` varchar(255) NOT NULL,
	CONSTRAINT `email` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `billing` (
	`id` varchar(30) NOT NULL,
	`workspace_id` varchar(30) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`customer_id` varchar(255),
	`payment_method_id` varchar(255),
	`payment_method_last4` varchar(4),
	`balance` bigint NOT NULL,
	`reload` boolean,
	CONSTRAINT `billing_workspace_id_id_pk` PRIMARY KEY(`workspace_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `payment` (
	`id` varchar(30) NOT NULL,
	`workspace_id` varchar(30) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`customer_id` varchar(255),
	`payment_id` varchar(255),
	`amount` bigint NOT NULL,
	CONSTRAINT `payment_workspace_id_id_pk` PRIMARY KEY(`workspace_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `usage` (
	`id` varchar(30) NOT NULL,
	`workspace_id` varchar(30) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`model` varchar(255) NOT NULL,
	`input_tokens` int NOT NULL,
	`output_tokens` int NOT NULL,
	`reasoning_tokens` int,
	`cache_read_tokens` int,
	`cache_write_tokens` int,
	`cost` bigint NOT NULL,
	CONSTRAINT `usage_workspace_id_id_pk` PRIMARY KEY(`workspace_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `key` (
	`id` varchar(30) NOT NULL,
	`workspace_id` varchar(30) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`user_id` text NOT NULL,
	`name` varchar(255) NOT NULL,
	`key` varchar(255) NOT NULL,
	`time_used` timestamp(3),
	CONSTRAINT `key_workspace_id_id_pk` PRIMARY KEY(`workspace_id`,`id`),
	CONSTRAINT `global_key` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` varchar(30) NOT NULL,
	`workspace_id` varchar(30) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`email` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`time_seen` timestamp(3),
	`color` int,
	CONSTRAINT `user_workspace_id_id_pk` PRIMARY KEY(`workspace_id`,`id`),
	CONSTRAINT `user_email` UNIQUE(`workspace_id`,`email`)
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` varchar(30) NOT NULL,
	`slug` varchar(255),
	`name` varchar(255),
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	CONSTRAINT `workspace_id` PRIMARY KEY(`id`),
	CONSTRAINT `slug` UNIQUE(`slug`)
);
