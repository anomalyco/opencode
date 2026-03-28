ALTER TABLE `workspace` ADD `type` text NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace` ADD `name` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD `directory` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD `extra` text;--> statement-breakpoint
ALTER TABLE `workspace` DROP COLUMN `config`;