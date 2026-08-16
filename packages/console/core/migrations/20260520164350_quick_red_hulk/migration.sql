CREATE TABLE `referral_code` (
	`workspace_id` varchar(30) PRIMARY KEY,
	`code` varchar(10) NOT NULL,
	`time_created` timestamp(3) NOT NULL DEFAULT (now()),
	`time_updated` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`time_deleted` timestamp(3),
	CONSTRAINT `code` UNIQUE INDEX(`code`)
);
--> statement-breakpoint
DROP INDEX `referral_invitee_account_id` ON `referral`;--> statement-breakpoint
DROP INDEX `referral_code` ON `workspace`;--> statement-breakpoint
CREATE UNIQUE INDEX `invitee_account_id` ON `referral` (`invitee_account_id`);--> statement-breakpoint
ALTER TABLE `workspace` DROP COLUMN `referral_code`;
