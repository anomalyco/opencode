CREATE TABLE `ui_open_project` (
	`view_id` text NOT NULL,
	`project_id` text NOT NULL,
	`position` integer NOT NULL,
	`expanded` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `ui_open_project_pk` PRIMARY KEY(`view_id`, `project_id`),
	CONSTRAINT `fk_ui_open_project_view_id_ui_project_view_id_fk` FOREIGN KEY (`view_id`) REFERENCES `ui_project_view`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ui_open_project_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `ui_open_project_view_id_position_unique` UNIQUE(`view_id`,`position`)
);
--> statement-breakpoint
CREATE TABLE `ui_project_view_last_project` (
	`view_id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_ui_project_view_last_project_view_id_ui_project_view_id_fk` FOREIGN KEY (`view_id`) REFERENCES `ui_project_view`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ui_project_view_last_project_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ui_project_view` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
