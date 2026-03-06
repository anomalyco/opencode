ALTER TABLE `session` ADD `org_id` text;--> statement-breakpoint
CREATE INDEX `session_org_idx` ON `session` (`org_id`);