ALTER TABLE `key` MODIFY COLUMN `user_id` varchar(30) NOT NULL;--> statement-breakpoint
ALTER TABLE `key` DROP COLUMN `actor`;--> statement-breakpoint
ALTER TABLE `key` DROP COLUMN `old_name`;