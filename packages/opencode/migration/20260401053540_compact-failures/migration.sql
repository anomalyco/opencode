ALTER TABLE `session` ADD `permission_mode` text;--> statement-breakpoint
ALTER TABLE `session` ADD `compact_failures` integer DEFAULT 0;