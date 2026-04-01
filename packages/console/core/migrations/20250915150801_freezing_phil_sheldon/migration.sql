ALTER TABLE `billing` ADD `last_error` varchar(255);--> statement-breakpoint
ALTER TABLE `billing` ADD `time_last_error` timestamp(3);--> statement-breakpoint
ALTER TABLE `payment` DROP COLUMN `error`;