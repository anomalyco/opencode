UPDATE `workspace` SET `referral_code` = NULL WHERE CHAR_LENGTH(`referral_code`) > 10;--> statement-breakpoint
ALTER TABLE `workspace` MODIFY COLUMN `referral_code` varchar(10);
