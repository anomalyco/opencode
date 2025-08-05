PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`time_created` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`time_completed` integer,
	`provider_id` text,
	`model_id` text,
	`mode` text,
	`path_cwd` text,
	`path_root` text,
	`is_summary` integer DEFAULT false,
	`cost` real DEFAULT 0,
	`tokens_input` integer DEFAULT 0,
	`tokens_output` integer DEFAULT 0,
	`tokens_reasoning` integer DEFAULT 0,
	`tokens_cache_read` integer DEFAULT 0,
	`tokens_cache_write` integer DEFAULT 0,
	`error_name` text,
	`error_message` text,
	`error_data` text,
	`system_prompts` text,
	`is_synced` integer DEFAULT false,
	`last_sync_timestamp` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_messages`("id", "session_id", "role", "time_created", "time_completed", "provider_id", "model_id", "mode", "path_cwd", "path_root", "is_summary", "cost", "tokens_input", "tokens_output", "tokens_reasoning", "tokens_cache_read", "tokens_cache_write", "error_name", "error_message", "error_data", "system_prompts", "is_synced", "last_sync_timestamp", "created_at", "updated_at") SELECT "id", "session_id", "role", "time_created", "time_completed", "provider_id", "model_id", "mode", "path_cwd", "path_root", "is_summary", "cost", "tokens_input", "tokens_output", "tokens_reasoning", "tokens_cache_read", "tokens_cache_write", "error_name", "error_message", "error_data", "system_prompts", "is_synced", "last_sync_timestamp", "created_at", "updated_at" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;