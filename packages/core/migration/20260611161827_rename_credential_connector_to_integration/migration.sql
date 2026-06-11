ALTER TABLE `credential` RENAME COLUMN `connector_id` TO `integration_id`;--> statement-breakpoint
DROP INDEX IF EXISTS `credential_connector_active_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `credential_integration_active_idx` ON `credential` (`integration_id`) WHERE "credential"."active" = 1;