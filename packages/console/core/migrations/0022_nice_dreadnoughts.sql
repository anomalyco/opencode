ALTER TABLE `user` ADD `account_id` varchar(30);--> statement-breakpoint
ALTER TABLE `user` ADD `old_account_id` varchar(30);--> statement-breakpoint
ALTER TABLE `user` ADD CONSTRAINT `user_account_id` UNIQUE(`workspace_id`,`account_id`);