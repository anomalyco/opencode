ALTER TABLE `account_state` ADD `active_org_id` text;--> statement-breakpoint
UPDATE `account_state` SET `active_org_id` = (SELECT `selected_org_id` FROM `account` WHERE `account`.`id` = `account_state`.`active_account_id`);--> statement-breakpoint
ALTER TABLE `account` DROP COLUMN `selected_org_id`;
