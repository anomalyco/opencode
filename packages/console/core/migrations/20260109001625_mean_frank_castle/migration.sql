DROP INDEX `workspace_user_id` ON `subscription`;--> statement-breakpoint
ALTER TABLE `subscription` ADD CONSTRAINT `workspace_user_id` UNIQUE(`workspace_id`,`user_id`);