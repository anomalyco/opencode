DROP TABLE `referral_code`;--> statement-breakpoint
DROP INDEX `referral_reward_referral_source` ON `referral_reward`;--> statement-breakpoint
DROP INDEX `referral_stripe_subscription_id` ON `referral`;--> statement-breakpoint
DROP INDEX `referral_inviter_workspace_id` ON `referral`;--> statement-breakpoint
DROP INDEX `referral_code_id` ON `referral`;--> statement-breakpoint
ALTER TABLE `referral_reward` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `referral` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `referral_reward` MODIFY COLUMN `workspace_id` varchar(30);--> statement-breakpoint
ALTER TABLE `workspace` ADD `referral_code` varchar(16);--> statement-breakpoint
ALTER TABLE `referral_reward` ADD PRIMARY KEY (`id`);--> statement-breakpoint
ALTER TABLE `referral` ADD PRIMARY KEY (`id`);--> statement-breakpoint
CREATE INDEX `referral_workspace_id` ON `referral` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_referral_code` ON `workspace` (`referral_code`);--> statement-breakpoint
ALTER TABLE `referral_reward` DROP COLUMN `source`;--> statement-breakpoint
ALTER TABLE `referral_reward` DROP COLUMN `applied_by_user_id`;--> statement-breakpoint
ALTER TABLE `referral` DROP COLUMN `inviter_workspace_id`;--> statement-breakpoint
ALTER TABLE `referral` DROP COLUMN `invitee_user_id`;--> statement-breakpoint
ALTER TABLE `referral` DROP COLUMN `referral_code_id`;--> statement-breakpoint
ALTER TABLE `referral` DROP COLUMN `stripe_customer_id`;--> statement-breakpoint
ALTER TABLE `referral` DROP COLUMN `stripe_subscription_id`;