ALTER TABLE `sessions` ADD `total_cost` real DEFAULT 0;--> statement-breakpoint
ALTER TABLE `sessions` ADD `total_tokens_input` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `sessions` ADD `total_tokens_output` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `sessions` ADD `total_tokens_reasoning` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `sessions` ADD `total_tokens_cache_read` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `sessions` ADD `total_tokens_cache_write` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `sessions` ADD `message_count` integer DEFAULT 0;