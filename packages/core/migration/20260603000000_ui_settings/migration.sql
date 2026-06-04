CREATE TABLE `ui_app_settings` (
	`profile_id` text PRIMARY KEY,
	`general_auto_save` integer NOT NULL,
	`general_release_notes` integer NOT NULL,
	`general_followup` text NOT NULL,
	`general_show_file_tree` integer NOT NULL,
	`general_show_navigation` integer NOT NULL,
	`general_show_search` integer NOT NULL,
	`general_show_status` integer NOT NULL,
	`general_show_terminal` integer NOT NULL,
	`general_show_reasoning_summaries` integer NOT NULL,
	`general_shell_tool_parts_expanded` integer NOT NULL,
	`general_edit_tool_parts_expanded` integer NOT NULL,
	`general_show_session_progress_bar` integer NOT NULL,
	`general_show_custom_agents` integer NOT NULL,
	`general_new_layout_designs` integer NOT NULL,
	`updates_startup` integer NOT NULL,
	`appearance_font_size` integer NOT NULL,
	`appearance_mono` text NOT NULL,
	`appearance_sans` text NOT NULL,
	`appearance_terminal` text NOT NULL,
	`permissions_auto_approve` integer NOT NULL,
	`notifications_agent` integer NOT NULL,
	`notifications_permissions` integer NOT NULL,
	`notifications_errors` integer NOT NULL,
	`sounds_agent_enabled` integer NOT NULL,
	`sounds_agent` text NOT NULL,
	`sounds_permissions_enabled` integer NOT NULL,
	`sounds_permissions` text NOT NULL,
	`sounds_errors_enabled` integer NOT NULL,
	`sounds_errors` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_ui_app_settings_profile_id_ui_settings_profile_id_fk` FOREIGN KEY (`profile_id`) REFERENCES `ui_settings_profile`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ui_keybind` (
	`profile_id` text NOT NULL,
	`action` text NOT NULL,
	`keybind` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `ui_keybind_pk` PRIMARY KEY(`profile_id`, `action`),
	CONSTRAINT `fk_ui_keybind_profile_id_ui_settings_profile_id_fk` FOREIGN KEY (`profile_id`) REFERENCES `ui_settings_profile`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ui_model_preference` (
	`profile_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`visibility` text NOT NULL,
	`favorite` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `ui_model_preference_pk` PRIMARY KEY(`profile_id`, `provider_id`, `model_id`),
	CONSTRAINT `fk_ui_model_preference_profile_id_ui_settings_profile_id_fk` FOREIGN KEY (`profile_id`) REFERENCES `ui_settings_profile`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ui_model_recent` (
	`profile_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`position` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `ui_model_recent_pk` PRIMARY KEY(`profile_id`, `provider_id`, `model_id`),
	CONSTRAINT `fk_ui_model_recent_profile_id_ui_settings_profile_id_fk` FOREIGN KEY (`profile_id`) REFERENCES `ui_settings_profile`(`id`) ON DELETE CASCADE,
	CONSTRAINT `ui_model_recent_profile_id_position_unique` UNIQUE(`profile_id`,`position`)
);
--> statement-breakpoint
CREATE TABLE `ui_model_variant` (
	`profile_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`variant` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `ui_model_variant_pk` PRIMARY KEY(`profile_id`, `provider_id`, `model_id`),
	CONSTRAINT `fk_ui_model_variant_profile_id_ui_settings_profile_id_fk` FOREIGN KEY (`profile_id`) REFERENCES `ui_settings_profile`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ui_settings_profile` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
