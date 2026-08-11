DROP INDEX `referral_reward_workspace_time` ON `referral_reward`;--> statement-breakpoint
ALTER TABLE `referral_reward` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `referral_reward` ADD PRIMARY KEY (`workspace_id`,`referral_id`);--> statement-breakpoint
ALTER TABLE `referral_reward` DROP COLUMN `id`;