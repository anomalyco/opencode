CREATE TABLE `app_config` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`server_url` text NOT NULL,
	`server_hostname` text DEFAULT '127.0.0.1',
	`server_port` integer DEFAULT 4096,
	`connection_status` text DEFAULT 'disconnected',
	`last_sync_timestamp` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`theme` text DEFAULT 'system',
	`default_provider_id` text,
	`default_model_id` text,
	`notifications_enabled` integer DEFAULT true,
	`haptics_enabled` integer DEFAULT true,
	`auto_sync` integer DEFAULT true,
	`cache_size_limit` integer DEFAULT 104857600,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `file_cache` (
	`path` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`mime_type` text,
	`file_type` text NOT NULL,
	`size` integer,
	`git_status` text,
	`server_modified_time` integer,
	`cached_at` integer NOT NULL,
	`last_accessed` integer NOT NULL,
	`access_count` integer DEFAULT 1,
	`is_pinned` integer DEFAULT false
);
--> statement-breakpoint
CREATE TABLE `search_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`query` text NOT NULL,
	`search_type` text NOT NULL,
	`results` text NOT NULL,
	`cached_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`title` text NOT NULL,
	`version` text NOT NULL,
	`share_url` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`revert_message_id` text,
	`revert_part_id` text,
	`revert_snapshot` text,
	`revert_diff` text,
	`is_synced` integer DEFAULT false,
	`last_sync_timestamp` integer,
	`is_favorite` integer DEFAULT false,
	`local_notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`time_created` integer NOT NULL,
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
CREATE TABLE `message_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`type` text NOT NULL,
	`text_content` text,
	`is_synthetic` integer DEFAULT false,
	`time_start` integer,
	`time_end` integer,
	`file_mime` text,
	`file_filename` text,
	`file_url` text,
	`file_source_type` text,
	`file_source_path` text,
	`file_source_text_value` text,
	`file_source_text_start` integer,
	`file_source_text_end` integer,
	`file_source_name` text,
	`file_source_kind` integer,
	`file_source_range` text,
	`tool_call_id` text,
	`tool_name` text,
	`tool_status` text,
	`tool_input` text,
	`tool_output` text,
	`tool_title` text,
	`tool_metadata` text,
	`tool_error` text,
	`tool_time_start` integer,
	`tool_time_end` integer,
	`step_cost` real,
	`step_tokens_input` integer,
	`step_tokens_output` integer,
	`step_tokens_reasoning` integer,
	`step_tokens_cache_read` integer,
	`step_tokens_cache_write` integer,
	`snapshot_id` text,
	`patch_hash` text,
	`patch_files` text,
	`is_synced` integer DEFAULT false,
	`last_sync_timestamp` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`context_window` integer,
	`max_output_tokens` integer,
	`cost_input` real,
	`cost_output` real,
	`is_available` integer DEFAULT true,
	`is_default` integer DEFAULT false,
	`last_sync_timestamp` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`website` text,
	`is_available` integer DEFAULT true,
	`last_sync_timestamp` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `event_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_type` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`data` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_type` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	`retry_count` integer DEFAULT 0,
	`max_retries` integer DEFAULT 3,
	`last_error` text,
	`status` text DEFAULT 'pending'
);
