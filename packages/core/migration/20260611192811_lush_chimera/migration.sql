ALTER TABLE `credential` ADD `integration_id` text NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `credential_connector_active_idx`;--> statement-breakpoint
ALTER TABLE `credential` DROP COLUMN `connector_id`;--> statement-breakpoint
ALTER TABLE `credential` DROP COLUMN `method_id`;--> statement-breakpoint
ALTER TABLE `credential` DROP COLUMN `active`;