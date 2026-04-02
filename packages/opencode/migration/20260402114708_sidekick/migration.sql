ALTER TABLE `session` ADD `kind` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE INDEX `session_kind_idx` ON `session` (`kind`);