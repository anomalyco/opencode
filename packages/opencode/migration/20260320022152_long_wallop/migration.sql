ALTER TABLE `plan` ADD `error` text;--> statement-breakpoint
CREATE INDEX `plan_project_status_idx` ON `plan` (`project_id`,`status`);