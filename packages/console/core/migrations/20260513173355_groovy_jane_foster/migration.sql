CREATE TABLE `referral_code` (
	`id` varchar(30) NOT NULL,
	`workspace_id` varchar(30) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`code` varchar(10) NOT NULL,
	CONSTRAINT PRIMARY KEY(`workspace_id`,`id`),
	CONSTRAINT `referral_code_workspace_id` UNIQUE INDEX(`workspace_id`),
	CONSTRAINT `referral_code_code` UNIQUE INDEX(`code`)
);
--> statement-breakpoint
CREATE TABLE `referral_reward` (
	`id` varchar(30) NOT NULL,
	`workspace_id` varchar(30) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`referral_id` varchar(30) NOT NULL,
	`source` enum('inviter','invitee') NOT NULL,
	`amount` bigint NOT NULL,
	`applied_by_user_id` varchar(30),
	`time_applied` timestamp(3),
	CONSTRAINT PRIMARY KEY(`workspace_id`,`id`),
	CONSTRAINT `referral_reward_referral_source` UNIQUE INDEX(`referral_id`,`source`)
);
--> statement-breakpoint
CREATE TABLE `referral` (
	`id` varchar(30) NOT NULL,
	`workspace_id` varchar(30) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	`inviter_workspace_id` varchar(30) NOT NULL,
	`invitee_account_id` varchar(30) NOT NULL,
	`invitee_user_id` varchar(30) NOT NULL,
	`referral_code_id` varchar(30) NOT NULL,
	`stripe_customer_id` varchar(255) NOT NULL,
	`stripe_subscription_id` varchar(255) NOT NULL,
	CONSTRAINT PRIMARY KEY(`workspace_id`,`id`),
	CONSTRAINT `referral_invitee_account_id` UNIQUE INDEX(`invitee_account_id`),
	CONSTRAINT `referral_stripe_subscription_id` UNIQUE INDEX(`stripe_subscription_id`)
);
--> statement-breakpoint
CREATE INDEX `referral_reward_workspace_time` ON `referral_reward` (`workspace_id`,`time_created`);--> statement-breakpoint
CREATE INDEX `referral_inviter_workspace_id` ON `referral` (`inviter_workspace_id`);--> statement-breakpoint
CREATE INDEX `referral_code_id` ON `referral` (`referral_code_id`);
