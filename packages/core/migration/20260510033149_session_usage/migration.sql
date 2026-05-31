ALTER TABLE `session` ADD `cost` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `tokens_input` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `tokens_output` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `tokens_reasoning` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `tokens_cache_read` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `tokens_cache_write` integer DEFAULT 0 NOT NULL;
