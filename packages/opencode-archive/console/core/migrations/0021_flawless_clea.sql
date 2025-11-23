ALTER TABLE `user` MODIFY COLUMN `email` varchar(255);--> statement-breakpoint
ALTER TABLE `user` ADD `old_email` varchar(255);