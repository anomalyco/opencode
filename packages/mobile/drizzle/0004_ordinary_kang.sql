ALTER TABLE `app_config` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`path` text NOT NULL,
	`server_url` text NOT NULL,
	`server_hostname` text NOT NULL,
	`server_port` integer NOT NULL,
	`app_hostname` text,
	`app_git` integer,
	`app_path_config` text,
	`app_path_data` text,
	`app_path_root` text,
	`app_path_cwd` text,
	`app_path_state` text,
	`app_time_initialized` integer,
	`connection_status` text DEFAULT 'disconnected',
	`last_sync_timestamp` integer,
	`is_active` integer DEFAULT false,
	`is_favorite` integer DEFAULT false,
	`color` text,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "name", "description", "path", "server_url", "server_hostname", "server_port", "app_hostname", "app_git", "app_path_config", "app_path_data", "app_path_root", "app_path_cwd", "app_path_state", "app_time_initialized", "connection_status", "last_sync_timestamp", "is_active", "is_favorite", "color", "created_at", "updated_at") SELECT "id", "name", "description", "path", "server_url", "server_hostname", "server_port", "app_hostname", "app_git", "app_path_config", "app_path_data", "app_path_root", "app_path_cwd", "app_path_state", "app_time_initialized", "connection_status", "last_sync_timestamp", "is_active", "is_favorite", "color", "created_at", "updated_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `sessions` ADD `project_id` text NOT NULL REFERENCES projects(id);